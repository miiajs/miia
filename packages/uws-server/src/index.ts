import type { us_listen_socket } from 'uWebSockets.js'

/**
 * @miiajs/uws-server - uWebSockets.js HTTP server for Web API frameworks.
 *
 * Requires `uWebSockets.js` to be installed separately:
 *   bun add uWebSockets.js@uNetworking/uWebSockets.js#v20.64.0
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
 * are bridged to a ReadableStream for true streaming.
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
 * - clone() returns a GlobalResponse, not LightResponse.
 * - Multiple serve instances: second close() restores GlobalResponse,
 *   which may break a still-running first instance.
 */

// ─── Symbols ─────────────────────────────────────────────────

/** Marker for LightResponse cached tuple: [status, body, headers] */
const CACHE = Symbol('responseCache')

const textDecoder = new TextDecoder()
const EMPTY_U8 = new Uint8Array(0)
const DEFAULT_BUFFER_THRESHOLD = 102_400 // 100KB
const DEFAULT_MAX_BODY_SIZE = 1_048_576 // 1MB

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
      this._real = new Request(this.url, init)
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

  // ── Body consumers: buffer fast path, stream fallback ──

  async json() {
    if (this._bodyPromise) {
      const buf = await this._getBuffer()
      return JSON.parse(textDecoder.decode(buf))
    }
    return this._getReal().json()
  },
  async text() {
    if (this._bodyPromise) {
      const buf = await this._getBuffer()
      return textDecoder.decode(buf)
    }
    return this._getReal().text()
  },
  async arrayBuffer() {
    if (this._bodyPromise) {
      const buf = await this._getBuffer()
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }
    return this._getReal().arrayBuffer()
  },

  get body() {
    // Stream path - original ReadableStream
    if (this._body) return this._body
    // Buffer path - lazy stream from buffer (cached)
    if (this._bodyPromise) {
      if (!this._bodyStream) {
        const self = this
        this._bodyStream = new ReadableStream({
          async start(controller) {
            try {
              const buf = await self._getBuffer()
              if (buf.byteLength > 0) controller.enqueue(buf)
              controller.close()
            } catch (e) {
              controller.error(e)
            }
          },
        })
      }
      return this._bodyStream
    }
    return null
  },
  get bodyUsed() {
    return this._bodyBuffer !== null || (this._real?.bodyUsed ?? false)
  },

  // Rare path - delegate to real Request
  blob() {
    return this._getReal().blob()
  },
  formData() {
    return this._getReal().formData()
  },
  clone() {
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
  proxy._ac = null
  proxy._real = null
  proxy._aborted = false
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
  maxBodySize = DEFAULT_MAX_BODY_SIZE,
  logger = console,
}: ServeOptions): Promise<{ close(): Promise<void> }> => {
  const native = mode === 'native'
  let listenSocket: us_listen_socket | null = null

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

    // ── 2. Sync: set up body stream ─────────────────────────

    const hasBody = method !== 'GET' && method !== 'HEAD'

    // ── Early 413: declared Content-Length over the cap, handler never runs ──
    // Fully synchronous - no async gap yet, so no onAborted registration is
    // needed. uWS closes the connection itself when a response ends before
    // the request body was consumed.
    if (maxBodySize !== false && hasBody && contentLength > maxBodySize) {
      res.cork(() => {
        res.writeStatus('413')
        res.writeHeader('content-type', 'application/json')
        res.end(JSON.stringify({ statusCode: 413, error: 'Payload Too Large', message: 'Payload Too Large' }))
      })
      return
    }

    const shouldBuffer = !native && hasBody && contentLength >= 0 && contentLength <= bufferThreshold

    let body: ReadableStream<Uint8Array> | undefined
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    let bodyClosed = false
    let bodyPromise: Promise<Uint8Array> | null = null
    let bodyReject: ((err: Error) => void) | null = null

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
      body = new ReadableStream<Uint8Array>({
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
              bodyClosed = true
              controller.close()
            }
          })
        },
      })
    }

    // ── 3. Create request + register onAborted (BEFORE dispatch!) ─

    let request: Request

    if (native) {
      const url = `http://${host || `${hostname}:${port}`}${path}${query ? '?' + query : ''}`
      const ac = new AbortController()
      request = new Request(url, {
        method,
        headers: new Headers(headerPairs),
        body,
        signal: ac.signal,
        // @ts-expect-error - duplex required for streaming request bodies in Node
        duplex: hasBody ? 'half' : undefined,
      })
      res.onAborted(() => {
        aborted = true
        ac.abort(new Error('Client connection closed'))
        if (bodyController && !bodyClosed) {
          try {
            bodyController.error(new Error('Request aborted'))
          } catch {
            /* already closed */
          }
        }
      })
    } else {
      request = createRequestProxy(method, headerPairs, body, bodyPromise, host, hostname, port, path, query)
      res.onAborted(() => {
        aborted = true
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
          try {
            bodyController.error(new Error('Request aborted'))
          } catch {
            /* already closed */
          }
        }
      })
    }

    // ── 4. Response helpers (close over res, aborted) ────────

    const sendError = (error: unknown) => {
      if (aborted) return
      logger.error(
        'Unhandled error',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        'UwsServer',
      )
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
    }

    const sendResponse = (response: Response): void | Promise<void> => {
      if (aborted) return

      // Fast path: LightResponse CACHE - zero async, one cork
      // Content-Length is set automatically by uWS res.end(body)
      const cached = (response as any)[CACHE]
      if (cached) {
        const [status, body, headers] = cached
        res.cork(() => {
          res.writeStatus(`${status}`)
          if (headers) {
            if (headers instanceof Headers) {
              headers.forEach((v: string, k: string) => res.writeHeader(k, v))
            } else {
              for (const k of Object.keys(headers)) res.writeHeader(k, (headers as any)[k])
            }
          }
          res.end(body ?? '')
        })
        return
      }

      // No body (e.g. native mode 204)
      if (!response.body) {
        res.cork(() => {
          res.writeStatus(`${response.status}`)
          response.headers.forEach((v: string, k: string) => res.writeHeader(k, v))
          res.end()
        })
        return
      }

      // Streaming fallback (SSE, large files)
      if (aborted) return
      return streamBody(response)
    }

    const streamBody = async (response: Response) => {
      res.cork(() => {
        res.writeStatus(`${response.status}`)
        response.headers.forEach((v: string, k: string) => res.writeHeader(k, v))
      })

      const reader = response.body!.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done || aborted) break
          res.cork(() => res.write(value))
        }
      } catch {
        // Response body stream errored
      } finally {
        reader.releaseLock()
      }

      if (!aborted) res.cork(() => res.end())
    }

    // ── 5. Dispatch: sync path when possible ────────────────

    try {
      const result = handler(request)

      if (result instanceof Promise) {
        result.then(sendResponse, sendError)
      } else {
        const p = sendResponse(result)
        if (p) p.catch(sendError)
      }
    } catch (error) {
      sendError(error)
    }
  })

  // ── Listen ─────────────────────────────────────────────────

  await new Promise<void>((resolve, reject) => {
    app.listen(port, (token: us_listen_socket | false) => {
      if (token) {
        listenSocket = token
        resolve()
      } else {
        reject(new Error(`[uws-server] Failed to listen on port ${port}`))
      }
    })
  })

  return {
    async close() {
      if (!native) {
        Object.defineProperty(globalThis, 'Response', { value: GlobalResponse, configurable: true })
      }
      if (listenSocket) {
        ;(uWS.default ?? uWS).us_listen_socket_close(listenSocket)
        listenSocket = null
      }
    },
  }
}
