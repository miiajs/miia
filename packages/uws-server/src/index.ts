import type { HttpResponse, us_listen_socket } from 'uWebSockets.js'

/**
 * @miiajs/uws-server - uWebSockets.js HTTP server for Web API frameworks.
 *
 * Requires `uWebSockets.js` to be installed separately:
 *   bun add uWebSockets.js@uNetworking/uWebSockets.js#v20.69.0
 *
 * Usage:
 *   import { serve } from '@miiajs/uws-server';
 *   serve({ fetch: app.fetch, port: 3000 });
 *
 * ## Architecture
 *
 * uWS HttpRequest is only valid synchronously - method, url, and headers
 * must be read before any async gap. Small bodies are accumulated natively
 * in C++ via res.collectBody(). Large bodies arrive via res.onData() and
 * are bridged to a ReadableStream for true streaming: once the stream's
 * queue passes bodyHighWaterMark the socket is paused with res.pause() and
 * resumed from the stream's pull(), so the client uploads at the handler's
 * pace instead of filling memory.
 *
 * ## Modes
 *
 * - **optimized** (default) - lazy Request proxy, LightResponse CACHE,
 *   sync handler path, lazy AbortController. For simple responses
 *   (string/null/Uint8Array), the entire request-response cycle is
 *   fully synchronous - zero Promises, one cork, one syscall.
 *
 * - **native** - standard Web API Request/Response objects,
 *   no proxies, no global overrides, full spec compliance.
 *   Safe for strict instanceof checks.
 *
 * After res.onAborted() fires, calling any method on res is undefined
 * behavior - every res.cork/write/end call is guarded by an `aborted` flag.
 *
 * ## Known Limitations (optimized mode)
 *
 * - Body can only be consumed once (matches Web API spec).
 * - Ending the response disposes an unread request body - the stream is
 *   errored, so a body read that was started and never awaited rejects.
 * - clone() returns a GlobalResponse, not LightResponse.
 * - Multiple serve instances: second close() restores GlobalResponse,
 *   which may break a still-running first instance.
 */

// ─── Symbols ─────────────────────────────────────────────────

/** Marker for LightResponse cached tuple: [status, body, headers] */
const CACHE = Symbol('responseCache')

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()
const EMPTY_U8 = new Uint8Array(0)
const DEFAULT_BUFFER_THRESHOLD = 102_400 // 100KB
const DEFAULT_BODY_HIGH_WATER_MARK = 262_144 // 256KB
const DEFAULT_MAX_BODY_SIZE = 1_048_576 // 1MB
// A streamed response body goes to uWS in pieces of at most this, so what waits in its buffer for the socket stays
// small
const STREAM_PIECE = 65_536 // 64KB

// ─── Lightweight Headers Proxy (optimized mode) ─────────────
//
// Linear scan over headerPairs instead of new Headers().
// uWS header keys are already lowercase - only the input name needs lowering.

const headersProto: Record<string | symbol, any> = {
  get(name: string): string | null {
    const lower = name.toLowerCase()
    const pairs = this._pairs
    let result: string | null = null
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i][0] === lower) {
        result = result === null ? pairs[i][1] : result + ', ' + pairs[i][1]
      }
    }
    return result
  },
  has(name: string): boolean {
    return this.get(name) !== null
  },
  forEach(callback: (value: string, key: string, parent: any) => void): void {
    for (const [k, v] of this._pairs) callback(v, k, this)
  },
  entries(): IterableIterator<[string, string]> {
    return this._pairs[Symbol.iterator]()
  },
  keys(): IterableIterator<string> {
    return this._pairs.map((p: [string, string]) => p[0])[Symbol.iterator]()
  },
  values(): IterableIterator<string> {
    return this._pairs.map((p: [string, string]) => p[1])[Symbol.iterator]()
  },
  [Symbol.iterator]() {
    return this.entries()
  },
  getSetCookie(): string[] {
    return this._pairs.filter((p: [string, string]) => p[0] === 'set-cookie').map((p: [string, string]) => p[1])
  },
}

function createHeadersProxy(pairs: [string, string][]): Headers {
  const proxy = Object.create(headersProto)
  proxy._pairs = pairs
  return proxy
}

// ─── Lightweight Request Proxy (optimized mode) ─────────────
//
// Object.create(requestProto) is ~100x cheaper than new Request().
// Properties accessed on the hot path (url, method) are simple reads.
// Everything else is lazy - created only when accessed.

/** What Node's own Request rejects a second body consumer with. */
function bodyUsedError(): TypeError {
  return new TypeError('Body is unusable: Body has already been read')
}

/** What Node's own Request throws from clone() once its body is used or locked. */
function cloneError(): TypeError {
  return new TypeError('unusable')
}

/**
 * A Host header that makes no valid URL (`x:99999`, `[::1`) would make `new Request()` throw, where Bun and Deno
 * serve the request: it is then built on `http://localhost` and its own path.
 */
function toRequest(url: string, target: string, init: RequestInit): Request {
  try {
    return new Request(url, init)
  } catch (error) {
    if (URL.canParse(url)) throw error
    return new Request(`http://localhost${target}`, init)
  }
}

/**
 * The Host native mode builds the URL on: host[:port] or [IPv6]:port. A path, a query, a fragment, userinfo or a
 * backslash in it would move the request off its own path (`Host: x/admin` turns `GET /public` into
 * `/admin/public`), so such a Host gives way to `localhost`.
 */
const PLAIN_HOST = /^(?:[\w.~!$&'()*+,;=%-]+|\[[\w:.%]+\])(?::\d*)?$/

/**
 * The answer to a request native mode cannot build a `Request` for: a method fetch refuses (`CONNECT`, `TRACE`,
 * `TRACK`), which Bun and Deno hand to the app, gets a 501 - the request is valid, this mode cannot carry it; anything
 * else, such as a method that is not a token, a 400.
 */
function refuseRequest(res: HttpResponse, method: string): void {
  const status = method === 'CONNECT' || method === 'TRACE' || method === 'TRACK' ? 501 : 400
  const error = status === 501 ? 'Not Implemented' : 'Bad Request'
  res.cork(() => {
    res.writeStatus(`${status}`)
    res.writeHeader('content-type', 'application/json')
    res.end(JSON.stringify({ statusCode: status, error, message: error }))
  })
}

const requestProto: Record<string | symbol, any> = {
  get method() {
    return this._method
  },
  get url() {
    return (this._url ??= `http://${this._host || `${this._hostname}:${this._port}`}${this._pathname}${this._search ? '?' + this._search : ''}`)
  },
  get headers() {
    return (this._headers ??= createHeadersProxy(this._headerPairs))
  },
  /** Lazy connection info - read by @miiajs/core's resolveConn. */
  get _conn() {
    return (this._connCache ??= connInfo(this._address, this._remotePort))
  },
  get signal() {
    if (!this._ac) {
      this._ac = new AbortController()
      if (this._aborted) this._ac.abort(new Error('Client connection closed'))
    }
    return this._ac.signal
  },

  /** Create real Request - only for rare operations (blob, formData, clone) */
  _getReal(): Request {
    if (!this._real) {
      const init: RequestInit = { method: this._method, headers: this._headerPairs }
      if (this._bodyPromise) {
        const buf = this._bodyBuffer
        if (buf && buf.byteLength > 0) {
          init.body = buf // Uint8Array is a valid BodyInit
        } else if (!buf) {
          const p = this._bodyPromise
          init.body = new ReadableStream({
            async start(c) {
              try {
                const b = await p
                if (b.byteLength > 0) c.enqueue(b)
                c.close()
              } catch (e) {
                c.error(e)
              }
            },
          })
          ;(init as any).duplex = 'half'
        }
      } else if (this._body) {
        init.body = this._body
        ;(init as any).duplex = 'half'
      }
      if (this._ac) init.signal = this._ac.signal
      this._real = toRequest(this.url, this._search ? `${this._pathname}?${this._search}` : this._pathname, init)
    }
    return this._real
  },

  // ── Buffer helper: resolve body promise, cache result ──

  async _getBuffer(): Promise<Uint8Array> {
    if (this._bodyBuffer !== null) return this._bodyBuffer
    if (!this._bodyPromise) return EMPTY_U8
    this._bodyBuffer = await this._bodyPromise
    return this._bodyBuffer
  },

  /** Buffer path: one consumer gets the body, as with a real Request - false once a consumer or `body` took it. */
  _claimBody(): boolean {
    const stream = this._bodyStream
    if (this._bodyUsed || stream?.locked) return false
    this._bodyUsed = true
    stream?.getReader() // a stream handed out before stays locked, as on a real Request
    return true
  },

  // ── Body consumers: buffer fast path, stream fallback ──

  async json() {
    if (this._bodyPromise) {
      if (!this._claimBody()) throw bodyUsedError()
      const buf = await this._getBuffer()
      return JSON.parse(textDecoder.decode(buf))
    }
    return this._getReal().json()
  },
  async text() {
    if (this._bodyPromise) {
      if (!this._claimBody()) throw bodyUsedError()
      const buf = await this._getBuffer()
      return textDecoder.decode(buf)
    }
    return this._getReal().text()
  },
  async arrayBuffer() {
    if (this._bodyPromise) {
      if (!this._claimBody()) throw bodyUsedError()
      const buf = await this._getBuffer()
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }
    return this._getReal().arrayBuffer()
  },
  async bytes() {
    if (this._bodyPromise) {
      if (!this._claimBody()) throw bodyUsedError()
      const buf = await this._getBuffer()
      return buf.slice()
    }
    return this._getReal().bytes()
  },

  get body() {
    // Stream path - the original ReadableStream, through the real Request so that bodyUsed sees it read
    if (this._body) return this._getReal().body
    // Buffer path - lazy stream from buffer (cached), read on demand so reading it is what uses the body
    if (this._bodyPromise) {
      if (!this._bodyStream) {
        const self = this
        this._bodyStream = new ReadableStream(
          {
            async pull(controller) {
              self._bodyUsed = true
              try {
                const buf = await self._getBuffer()
                if (buf.byteLength > 0) controller.enqueue(buf)
                controller.close()
              } catch (e) {
                controller.error(e)
              }
            },
          },
          { highWaterMark: 0 },
        )
        // Taken by a consumer already: locked, like a real Request's body
        if (this._bodyUsed) this._bodyStream.getReader()
      }
      return this._bodyStream
    }
    return null
  },
  get bodyUsed() {
    return this._bodyUsed || (this._real?.bodyUsed ?? false)
  },

  // Rare path - delegate to real Request
  blob() {
    if (this._bodyPromise && !this._claimBody()) return Promise.reject(bodyUsedError())
    return this._getReal().blob()
  },
  formData() {
    if (this._bodyPromise && !this._claimBody()) return Promise.reject(bodyUsedError())
    return this._getReal().formData()
  },
  clone() {
    // Buffer path: once a consumer or a read of `body` took the body, a Request built from the buffer would hand it
    // out again
    if (this._bodyPromise && (this._bodyUsed || this._bodyStream?.locked)) throw cloneError()
    return this._getReal().clone()
  },

  // Static spec-compliant defaults
  get cache() {
    return 'default' as const
  },
  get credentials() {
    return 'same-origin' as const
  },
  get destination() {
    return '' as const
  },
  get integrity() {
    return ''
  },
  get keepalive() {
    return false
  },
  get mode() {
    return 'cors' as const
  },
  get redirect() {
    return 'follow' as const
  },
  get referrer() {
    return ''
  },
  get referrerPolicy() {
    return '' as const
  },
}

function createRequestProxy(
  method: string,
  headerPairs: [string, string][],
  body: ReadableStream<Uint8Array> | undefined,
  bodyPromise: Promise<Uint8Array> | null,
  host: string,
  hostname: string,
  port: number,
  pathname: string,
  query: string,
  address: string,
  remotePort: number | undefined,
): Request {
  const proxy = Object.create(requestProto)
  proxy._method = method
  proxy._host = host
  proxy._hostname = hostname
  proxy._port = port
  proxy._pathname = pathname
  proxy._search = query
  proxy._url = null
  proxy._headerPairs = headerPairs
  proxy._headers = null
  proxy._body = body
  proxy._bodyPromise = bodyPromise
  proxy._bodyBuffer = null
  proxy._bodyStream = null
  proxy._bodyUsed = false
  proxy._ac = null
  proxy._real = null
  proxy._aborted = false
  proxy._address = address
  proxy._remotePort = remotePort
  proxy._connCache = null
  return proxy
}

// ─── Cached Response (LightResponse, optimized mode) ────────
//
// Replaces globalThis.Response. For string/null/Uint8Array bodies,
// stores [status, body, headers] in CACHE symbol - no GlobalResponse
// created. Adapter reads CACHE directly for cork + end.

const GlobalResponse = globalThis.Response

class LightResponse {
  #body: BodyInit | null
  #init: ResponseInit | undefined
  #real?: InstanceType<typeof GlobalResponse>;

  [CACHE]?: [number, any, any]

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this.#body = body ?? null
    this.#init = init
    if (body === null || typeof body === 'string' || body instanceof Uint8Array) {
      const h = init?.headers
      this[CACHE] = [
        init?.status ?? 200,
        body,
        h == null ? null : h instanceof Headers ? h : new Headers(h as HeadersInit),
      ]
    }
  }

  /** Create real GlobalResponse - only for streaming/advanced operations */
  #getReal(): InstanceType<typeof GlobalResponse> {
    return (this.#real ??= new GlobalResponse(this.#body, this.#init))
  }

  get status() {
    return this[CACHE]?.[0] ?? this.#getReal().status
  }

  get statusText() {
    return this.#init?.statusText ?? ''
  }

  get ok() {
    return this.status >= 200 && this.status < 300
  }

  get headers() {
    if (this[CACHE]) {
      return (this[CACHE]![2] ??= new Headers())
    }
    return this.#getReal().headers
  }

  get body() {
    return this.#getReal().body
  }

  get bodyUsed() {
    return this.#real?.bodyUsed ?? false
  }

  get type() {
    return 'default' as const
  }

  get url() {
    return ''
  }

  get redirected() {
    return false
  }

  clone() {
    return this.#getReal().clone()
  }

  json() {
    return this.#getReal().json()
  }

  text() {
    return this.#getReal().text()
  }

  arrayBuffer() {
    return this.#getReal().arrayBuffer()
  }

  blob() {
    return this.#getReal().blob()
  }

  formData() {
    return this.#getReal().formData()
  }

  bytes() {
    return this.#getReal().bytes()
  }

  static json(data: unknown, init?: ResponseInit): LightResponse {
    const body = JSON.stringify(data)
    const headers = init?.headers ? new Headers(init.headers) : new Headers()
    headers.set('content-type', 'application/json')
    return new LightResponse(body, { ...init, headers })
  }

  static redirect(url: string, status = 302): LightResponse {
    return new LightResponse(null, { status, headers: { Location: url } })
  }

  static error(): InstanceType<typeof GlobalResponse> {
    return new GlobalResponse(null, { status: 0 })
  }
}

// Prototype chain: instanceof GlobalResponse checks pass for LightResponse
Object.setPrototypeOf(LightResponse, GlobalResponse)
Object.setPrototypeOf(LightResponse.prototype, GlobalResponse.prototype)

// ─── Serve ───────────────────────────────────────────────────

interface LoggerLike {
  error(message: string, trace?: string, context?: string): void
}

export interface ServeOptions {
  fetch: (req: Request) => Response | Promise<Response>
  port?: number
  hostname?: string
  /** @default 'optimized' */
  mode?: 'optimized' | 'native'
  /** Bodies with Content-Length <= threshold are buffered as Promise<Uint8Array> for fast path.
   *  Larger or without Content-Length → ReadableStream. @default 102400 (100KB) */
  bufferThreshold?: number
  /** Bytes a streamed request body may queue before the socket is paused; it resumes as the
   *  handler drains the stream. Very small values trade memory for pause/resume churn.
   *  @default 262144 (256KB) */
  bodyHighWaterMark?: number
  /** Max request body size in bytes. A larger declared Content-Length gets an immediate
   *  413 response (handler never runs); chunked bodies error mid-stream past the cap
   *  (the body stream rejects with an Error named 'PayloadTooLargeError', which
   *  @miiajs/core maps to a 413). `false` disables the cap. Miia passes its computed
   *  ceiling automatically via `app.listen(port, serve)`. @default 1048576 (1MB) */
  maxBodySize?: number | false
  /** Logger for unhandled handler errors. Defaults to `console`. Miia passes its internal logger automatically when used via `app.listen(port, hostname, serve)`. */
  logger?: LoggerLike
}

export const serve = async ({
  port = 3000,
  hostname = '0.0.0.0',
  fetch: handler,
  mode = 'optimized',
  bufferThreshold = DEFAULT_BUFFER_THRESHOLD,
  bodyHighWaterMark = DEFAULT_BODY_HIGH_WATER_MARK,
  maxBodySize = DEFAULT_MAX_BODY_SIZE,
  logger = console,
}: ServeOptions): Promise<{ close(): Promise<void> }> => {
  // Must run before the globalThis.Response swap below - throwing after it would leave
  // LightResponse installed with no close() to restore it.
  if (!Number.isInteger(bodyHighWaterMark) || bodyHighWaterMark < 1) {
    throw new TypeError(`[uws-server] bodyHighWaterMark must be an integer >= 1, got ${bodyHighWaterMark}`)
  }

  const native = mode === 'native'
  let listenSocket: us_listen_socket | null = null

  // Requests dispatched and not yet answered or aborted - close() waits for them
  let inFlight = 0
  let drained: Promise<void> | null = null
  let resolveDrained = () => {}

  if (!native) {
    Object.defineProperty(globalThis, 'Response', { value: LightResponse, configurable: true })
  }

  const uWS = await import('uWebSockets.js')
  const app = (uWS.default ?? uWS).App()

  app.any('/*', (res, req) => {
    let aborted = false

    // ── 1. Sync: read request metadata before async gap ─────

    const method = req.getCaseSensitiveMethod().toUpperCase()
    const query = req.getQuery()
    const path = req.getUrl()
    const headerPairs: [string, string][] = []
    let host = ''
    let contentLength = -1
    req.forEach((key: string, value: string) => {
      headerPairs.push([key, value])
      if (key === 'host') host = value
      else if (key === 'content-length') contentLength = +value
    })

    // ── Connection info: must read remote address in the sync section ──
    // (uWS invalidates res after the first async gap). getRemotePort() returns
    // 0 when the port is unavailable, normalized to undefined.
    const address = textDecoder.decode(res.getRemoteAddressAsText())
    const remotePort = res.getRemotePort() || undefined

    // ── 2. Sync: set up body stream ─────────────────────────

    const hasBody = method !== 'GET' && method !== 'HEAD'

    // Counted in flight: set at dispatch, cleared by the one finish() that counts it out
    let counted = false

    // The response is out, or the client went away
    const finish = () => {
      if (!counted) return
      counted = false
      if (--inFlight === 0 && drained !== null) {
        drained = null
        resolveDrained()
      }
    }

    // ── Early 413: declared Content-Length over the cap, handler never runs ──
    // Fully synchronous - no async gap yet, so no onAborted registration is
    // needed. No onData handler is registered on this path, so uWS discards
    // the incoming body itself. The connection cannot carry another request
    // until that body is through, so the answer says Connection: close.
    if (maxBodySize !== false && hasBody && contentLength > maxBodySize) {
      res.cork(() => {
        res.writeStatus('413')
        res.writeHeader('content-type', 'application/json')
        res.writeHeader('connection', 'close')
        res.end(JSON.stringify({ statusCode: 413, error: 'Payload Too Large', message: 'Payload Too Large' }))
      })
      return
    }

    const shouldBuffer = !native && hasBody && contentLength >= 0 && contentLength <= bufferThreshold

    let body: ReadableStream<Uint8Array> | undefined
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    let bodyClosed = false
    let bodyPaused = false
    let responseEnded = false
    let bodyPromise: Promise<Uint8Array> | null = null
    let bodyReject: ((err: Error) => void) | null = null
    // Resumes a response waiting for onWritable - set only while one is under backpressure
    let wake: (() => void) | null = null
    // A response write waits for onWritable: the request body must not pause the socket meanwhile
    let writing = false
    // The reader of a streamed response body - a client gone while it waits for the source cancels the source
    let reading: ReadableStreamDefaultReader<unknown> | null = null

    if (shouldBuffer) {
      // ── Buffer path: small body accumulated natively in C++ ──
      bodyPromise = new Promise<Uint8Array>((resolve, reject) => {
        bodyReject = reject
        res.collectBody(bufferThreshold, (fullBody: ArrayBuffer | null) => {
          bodyReject = null
          if (fullBody === null) {
            reject(new Error(`Body size exceeded buffer threshold ${bufferThreshold}`))
          } else if (fullBody.byteLength === 0) {
            resolve(EMPTY_U8)
          } else {
            // Copy - collectBody neutering behavior is undocumented
            resolve(new Uint8Array(fullBody.slice(0)))
          }
        })
      })
      bodyPromise.catch(() => {}) // prevent unhandled rejection if handler never reads body
    } else if (hasBody) {
      // ── Stream path: large body, no Content-Length, or native mode ──
      // Chunked bodies (no CL) are capped in-stream: uWS enforces CL framing
      // for valid declared lengths, and oversized ones were pre-checked above.
      // `!(contentLength >= 0)`, not `< 0`: a malformed header yields NaN, for
      // which both the early 413 and `< 0` are false.
      const streamLimit = maxBodySize !== false && !(contentLength >= 0) ? maxBodySize : -1
      let received = 0
      body = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            bodyController = controller
            res.onData((chunk: ArrayBuffer, isLast: boolean) => {
              if (bodyClosed) return // already errored on limit - ignore remaining chunks
              if (streamLimit >= 0) {
                received += chunk.byteLength
                if (received > streamLimit) {
                  // Set BEFORE controller.error: the onAborted handlers guard on
                  // !bodyClosed, so this prevents a double-error on the controller.
                  bodyClosed = true
                  const err = new Error(`Request body exceeded ${streamLimit} byte limit`)
                  err.name = 'PayloadTooLargeError' // mapped to 413 by @miiajs/core
                  try {
                    controller.error(err)
                  } catch {
                    /* already closed */
                  }
                  return
                }
              }
              if (chunk.byteLength > 0) {
                // Must copy - uWS reuses the underlying ArrayBuffer memory
                controller.enqueue(new Uint8Array(chunk.slice(0)))
              }
              if (isLast) {
                // uWS delivers isLast out of its own buffer even after pause()
                if (bodyPaused) {
                  bodyPaused = false
                  if (!aborted) res.resume()
                }
                bodyClosed = true
                controller.close()
              } else if (!bodyPaused && !aborted && !responseEnded && (controller.desiredSize ?? 1) <= 0) {
                if (!writing) {
                  bodyPaused = true
                  res.pause()
                } else if (controller.desiredSize! < -bodyHighWaterMark) {
                  // A response write waits and the socket must keep reading: past twice the high-water mark the
                  // unread body is given up, and what still arrives is dropped like after a response
                  bodyClosed = true
                  controller.error(new Error('Request body piled up unread while the response waited for the client'))
                }
              }
            })
          },
          pull() {
            if (bodyPaused && !bodyClosed && !aborted && !responseEnded) {
              bodyPaused = false
              res.resume()
            }
          },
        },
        new ByteLengthQueuingStrategy({ highWaterMark: bodyHighWaterMark }),
      )
    }

    // ── 3. Create request + register onAborted (BEFORE dispatch!) ─

    let request: Request

    if (native) {
      const target = query ? `${path}?${query}` : path
      const ac = new AbortController()
      const authority = host === '' ? `${hostname}:${port}` : PLAIN_HOST.test(host) ? host : 'localhost'
      try {
        request = toRequest(`http://${authority}${target}`, target, {
          method,
          headers: new Headers(headerPairs),
          body,
          signal: ac.signal,
          // @ts-expect-error - duplex required for streaming request bodies in Node
          duplex: hasBody ? 'half' : undefined,
        })
      } catch {
        // What still comes of the body is dropped, as after any response
        bodyClosed = true
        refuseRequest(res, method)
        return
      }
      ;(request as any)._conn = connInfo(address, remotePort)
      res.onAborted(() => {
        aborted = true
        wake?.()
        reading?.cancel().catch(() => {})
        finish()
        ac.abort(new Error('Client connection closed'))
        if (bodyController && !bodyClosed) {
          bodyClosed = true
          try {
            bodyController.error(new Error('Request aborted'))
          } catch {
            /* already closed */
          }
        }
      })
    } else {
      request = createRequestProxy(
        method,
        headerPairs,
        body,
        bodyPromise,
        host,
        hostname,
        port,
        path,
        query,
        address,
        remotePort,
      )
      res.onAborted(() => {
        aborted = true
        wake?.()
        reading?.cancel().catch(() => {})
        finish()
        ;(request as any)._aborted = true
        if ((request as any)._ac) {
          ;(request as any)._ac.abort(new Error('Client connection closed'))
        }
        // Buffer path
        if (bodyReject) {
          bodyReject(new Error('Request aborted'))
          bodyReject = null
        }
        // Stream path
        if (bodyController && !bodyClosed) {
          bodyClosed = true
          try {
            bodyController.error(new Error('Request aborted'))
          } catch {
            /* already closed */
          }
        }
      })
    }

    // ── 4. Response helpers (close over res, aborted) ────────

    // A socket paused for backpressure must not stay paused once the response is
    // out - the keep-alive connection wedges (measured). Ending with uWS's
    // closeConnection flag is not the answer either: it races the response onto
    // the wire and loses it about a third of the time (measured). Dispose of the
    // body and resume instead, so onData's bodyClosed early-return drops the
    // remainder. The body still reaches its end, so the connection stays reusable
    // and needs no Connection: close.
    const releaseBody = () => {
      responseEnded = true
      if (bodyController && !bodyClosed) {
        bodyClosed = true
        // error, not close: a body cut off mid-flight must never look complete
        try {
          bodyController.error(new Error('Response ended before the request body was read'))
        } catch {
          /* already closed */
        }
      }
      if (bodyPaused) {
        bodyPaused = false
        if (!aborted) res.resume()
      }
    }

    const sendError = (error: unknown) => {
      if (aborted || responseEnded) {
        // Thrown while the response was being written: what went out cannot be completed, so the connection goes
        if (!aborted) res.close()
        finish()
        return
      }
      logger.error(
        'Unhandled error',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        'UwsServer',
      )
      releaseBody()
      res.cork(() => {
        res.writeStatus('500')
        res.writeHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'Internal Server Error',
          }),
        )
      })
      finish()
    }

    // HEAD and 304 report the declared length and send no body; 1xx and 204 carry no Content-Length at all
    // (RFC 9110 8.6); anything else without a body is an empty one. The length goes out as a header:
    // endWithoutBody(length) would also switch off uWS's idle timeout.
    const endEmpty = (status: number, length: number) => {
      if (method === 'HEAD' || status === 304) {
        if (length >= 0) res.writeHeader('content-length', `${length}`)
        res.endWithoutBody()
      } else if (status === 204 || status < 200) {
        res.endWithoutBody()
      } else {
        res.end()
      }
    }

    const sendResponse = (response: Response): void | Promise<void> => {
      if (aborted) return

      // Fast path: LightResponse CACHE - zero async, one cork
      // Content-Length is set automatically by uWS res.end(body)
      const cached = (response as any)[CACHE]
      if (cached) {
        const [status, body, headers] = cached
        releaseBody()
        res.cork(() => {
          res.writeStatus(`${status}`)
          const length = headers ? writeHeaders(res, headers instanceof Headers ? headers : new Headers(headers)) : -1
          if (body === null) endEmpty(status, length)
          else res.end(body)
        })
        finish()
        return
      }

      // No body (e.g. native mode 204, a HEAD answer)
      if (!response.body) {
        releaseBody()
        res.cork(() => {
          res.writeStatus(`${response.status}`)
          endEmpty(response.status, writeHeaders(res, response.headers))
        })
        finish()
        return
      }

      // Streaming fallback (SSE, large files)
      if (aborted) return
      return streamBody(response).finally(finish)
    }

    const streamBody = async (response: Response) => {
      let length = -1
      res.cork(() => {
        res.writeStatus(`${response.status}`)
        length = writeHeaders(res, response.headers)
      })
      if (length >= 0) return streamFixed(response.body!, length)

      // What the socket does not take stays in uWS's buffer, so the next piece waits for a writable event; pieces
      // of at most STREAM_PIECE keep that buffer, and what is left in it at the end, small
      const reader = response.body!.getReader()
      reading = reader
      let complete = false
      let failed = false
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) complete = true
          if (done || aborted) break
          const chunk = toBytes(value)
          if (chunk === null) {
            failed = true
            break
          }
          for (let at = 0; at < chunk.byteLength && !aborted; at += STREAM_PIECE) {
            const piece = chunk.subarray(at, at + STREAM_PIECE)
            let ok = false
            res.cork(() => {
              ok = res.write(piece)
            })
            if (!ok && !aborted) await waitWritable(() => true)
          }
        }
      } catch {
        // Response body stream errored
        failed = true
      } finally {
        // A client gone or a source failed: the producer (SSE) is told to stop
        if (!complete) reader.cancel().catch(() => {})
        reading = null
        reader.releaseLock()
      }

      releaseBody()
      if (aborted) return
      // Closed, not ended: a body cut off by its source must not look complete
      if (failed) res.close()
      else res.cork(() => res.end())
    }

    // A declared length goes out as the only framing: tryEnd() writes it as Content-Length and streams the body
    // against it. A source that turns out longer or shorter, or errors, closes the connection - ending would put a
    // wrong frame on the wire. The chunk that completes the body waits for the source to end, so a longer one is
    // caught too.
    const streamFixed = async (body: ReadableStream<Uint8Array>, total: number) => {
      const reader = body.getReader()
      reading = reader
      let sent = 0
      let last: Uint8Array | null = null
      let intact = false
      try {
        while (!aborted) {
          const { done, value } = await reader.read()
          if (done) {
            intact = sent === total
            break
          }
          if (aborted) break
          const chunk = toBytes(value)
          if (chunk === null || sent + chunk.byteLength > total) break
          if (chunk.byteLength === 0) continue
          sent += chunk.byteLength
          if (sent === total) last = chunk
          else await sendChunk(chunk, total)
        }
      } catch {
        // Response body stream errored
      } finally {
        if (!intact) reader.cancel().catch(() => {})
        reading = null
        reader.releaseLock()
      }

      releaseBody()
      if (aborted) return
      if (!intact) res.close()
      else if (last === null) res.cork(() => res.end())
      else await sendChunk(last, total)
    }

    // Hands a chunk to uWS; under backpressure waits for onWritable and retries the unsent rest from its offset
    const sendChunk = async (chunk: Uint8Array, total: number) => {
      let offset = 0
      let ok = false
      res.cork(() => {
        offset = res.getWriteOffset()
        ok = res.tryEnd(chunk, total)[0]
      })
      if (ok || aborted) return
      await waitWritable((at) => {
        let sent = false
        res.cork(() => {
          sent = res.tryEnd(chunk.subarray(at - offset), total)[0]
        })
        return sent
      })
    }

    // Until `retry` goes through on a writable event. A socket paused for the request body gets none, so the body
    // is resumed and is not paused again while the write waits - it queues unread meanwhile.
    const waitWritable = async (retry: (offset: number) => boolean) => {
      writing = true
      if (bodyPaused) {
        bodyPaused = false
        res.resume()
        // resume() polls for reads only: a retry asks for a writable event again if it falls short
        if (retry(res.getWriteOffset())) {
          writing = false
          return
        }
      }
      await new Promise<void>((resolve) => {
        wake = resolve
        res.onWritable((at) => {
          const sent = retry(at)
          if (sent) resolve()
          return sent
        })
      })
      wake = null
      writing = false
    }

    // A throw from sendResponse itself must not escape: it would keep the request in flight and close() waiting
    const safeSend = (response: Response) => {
      try {
        const p = sendResponse(response)
        if (p) p.catch(sendError)
      } catch (error) {
        sendError(error)
      }
    }

    // ── 5. Dispatch: sync path when possible ────────────────

    counted = true
    inFlight++
    try {
      const result = handler(request)

      if (result instanceof Promise) result.then(safeSend, sendError)
      else safeSend(result)
    } catch (error) {
      sendError(error)
    }
  })

  // ── Listen ─────────────────────────────────────────────────

  await new Promise<void>((resolve, reject) => {
    app.listen(hostname, port, (token: us_listen_socket | false) => {
      if (token) {
        listenSocket = token
        resolve()
      } else {
        reject(new Error(`[uws-server] Failed to listen on port ${port}`))
      }
    })
  })

  return {
    // Stops accepting, then waits for the requests in flight - no timeout. Keep-alive connections stay open
    // meanwhile, so a request still arriving on one is served and waited for too; after the drain every
    // connection left is closed, so none is served once close() has resolved.
    async close() {
      if (listenSocket) {
        ;(uWS.default ?? uWS).us_listen_socket_close(listenSocket)
        listenSocket = null
      }
      if (inFlight > 0) {
        await (drained ??= new Promise<void>((resolve) => {
          resolveDrained = resolve
        }))
      }
      app.close()
      // After the drain: a response built while it runs still gets LightResponse
      if (!native) {
        Object.defineProperty(globalThis, 'Response', { value: GlobalResponse, configurable: true })
      }
    },
  }
}

/** The connection info core reads; the address is the text uWS gives, an IPv6 one in its expanded form. */
function connInfo(
  address: string,
  remotePort: number | undefined,
): { remoteAddress: string; remotePort?: number; family: 'IPv4' | 'IPv6' } {
  return { remoteAddress: address, remotePort, family: address.includes(':') ? 'IPv6' : 'IPv4' }
}

/**
 * Writes the response headers except Content-Length and Transfer-Encoding: uWS frames every response itself, and
 * a forwarded copy would go out next to its own. Returns the declared Content-Length, -1 when there is none or it
 * is not a valid length.
 */
function writeHeaders(res: HttpResponse, headers: Headers): number {
  let length = -1
  headers.forEach((value: string, key: string) => {
    if (key === 'content-length') length = /^\d{1,15}$/.test(value) ? Number(value) : -1
    else if (key !== 'transfer-encoding') res.writeHeader(key, value)
  })
  return length
}

/** A response body chunk as bytes - a stream may yield strings or other views, a declared length counts bytes. */
function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (typeof value === 'string') return textEncoder.encode(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return null
}
