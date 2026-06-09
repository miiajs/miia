/**
 * @miiajs/node-server - high-performance Node.js HTTP server for Web API frameworks.
 *
 * ## Architecture
 *
 * Three optimizations inspired by @hono/node-server that eliminate Web API
 * overhead on Node.js (~57k req/sec vs ~36k with naive new Request/Response):
 *
 * 1. **Lazy Request Proxy** - instead of `new Request()` (~1.27µs), creates a
 *    plain object with getters that read from IncomingMessage directly.
 *    `req.url` and `req.method` are simple property reads. Headers, body,
 *    signal, and the real Request are created lazily on first access.
 *
 * 2. **Cached Response (LightResponse)** - overrides `globalThis.Response` so
 *    `new Response(body, init)` stores `[status, body, headers]` as a tuple
 *    for string/null/Uint8Array bodies. The real GlobalResponse is never
 *    created unless streaming body or advanced methods (clone, text, etc.)
 *    are accessed.
 *
 * 3. **Sync Listener** - no async/await in the request handler. When
 *    `handle()` returns a Response synchronously (common for GET with no
 *    middleware), it writes directly to ServerResponse via the CACHE fast
 *    path: `writeHead() + end(body)` - zero Promise allocation.
 *
 * ## Request Body Handling
 *
 * Body methods (`json()`, `text()`, etc.) delegate to a lazily-created
 * GlobalRequest backed by `Readable.toWeb(incoming)`. No custom buffering -
 * body reading uses the platform's standard Request implementation.
 * Body can only be consumed once (Web API spec).
 *
 * ## Abort & Cleanup
 *
 * - **AbortController** - created lazily on `req.signal` access. Close
 *   listener is registered at that point to abort on client disconnect.
 * - **Body drain** - for POST/PUT/PATCH/DELETE, close listener is registered
 *   eagerly to drain unconsumed body (500ms timeout, 64MB limit).
 * - **GET/HEAD** - no close listener overhead (lazy via `_ensureCloseListener`).
 *
 * ## Global Override
 *
 * `listen()` replaces `globalThis.Response` with LightResponse.
 * `close()` restores the original. LightResponse prototype chain is set via
 * `Object.setPrototypeOf` so `instanceof Response` checks pass.
 *
 * ## Native Mode
 *
 * `serve({ mode: 'native' })` disables all optimizations - uses real
 * `new Request()` / `new Response()`, no global overrides, no proxies.
 * Slower (~36k req/sec) but fully spec-compliant and safe for environments
 * with multiple frameworks or strict `instanceof` checks.
 *
 * ## Known Limitations (optimized mode)
 *
 * - `clone()` returns a GlobalResponse, not LightResponse - `instanceof`
 *    after clone may behave differently.
 * - `formData()` creates a real GlobalRequest (Content-Type boundary parsing).
 * - Multiple adapter instances: second `close()` restores GlobalResponse,
 *   which may break a still-running first adapter.
 * - Body can only be consumed once (matches Web API spec).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

// ─── Symbols ─────────────────────────────────────────────────

/** Marker for LightResponse cached tuple: [status, body, headers] */
const CACHE = Symbol('responseCache')

const textDecoder = new TextDecoder()
const EMPTY_U8 = new Uint8Array(0)
const DEFAULT_BUFFER_THRESHOLD = 102_400 // 100KB
const DEFAULT_MAX_BODY_SIZE = 1_048_576 // 1MB

// ─── Lightweight Headers Proxy ───────────────────────────────
//
// Linear scan over headerPairs instead of new Headers().
// Keys are lowercased once during pair construction.

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
  return proxy as any
}

// ─── Lightweight Request Proxy ───────────────────────────────
//
// Object.create(requestProto) is ~100x cheaper than new Request().
// Properties accessed on the hot path (url, method) are simple reads.
// Everything else is lazy - created only when accessed.

const requestProto: Record<string | symbol, any> = {
  get method() {
    return this._incoming.method || 'GET'
  },
  get url() {
    if (!this._url) {
      const host = this._incoming.headers.host ?? `${this._hostname}:${this._port}`
      this._url = `http://${host}${this._pathname}${this._search ? '?' + this._search : ''}`
    }
    return this._url
  },
  _getPairs() {
    if (!this._headerPairs) {
      const pairs: [string, string][] = []
      const raw = this._incoming.rawHeaders
      for (let i = 0; i < raw.length; i += 2) {
        if (raw[i].charCodeAt(0) !== 58) pairs.push([raw[i].toLowerCase(), raw[i + 1]]) // skip :pseudo-headers
      }
      this._headerPairs = pairs
    }
    return this._headerPairs
  },
  get headers() {
    return (this._headers ??= createHeadersProxy(this._getPairs()))
  },
  get signal() {
    if (!this._abortController) {
      this._abortController = new AbortController()
      this._ensureCloseListener?.() // register close listener to abort on disconnect
    }
    return this._abortController.signal
  },

  /** Create real GlobalRequest - only for rare operations (blob, formData, clone) */
  _getReal(): Request {
    if (!this._real) {
      const method = this._incoming.method || 'GET'
      const hasBody = method !== 'GET' && method !== 'HEAD'
      const init: RequestInit = { method, headers: this._getPairs() }
      if (hasBody) {
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
            }) as any
            ;(init as any).duplex = 'half'
          }
        } else {
          // Stream path - original Readable.toWeb, capped when a body limit is
          // set (chunked bodies). Single injection point: every consumer
          // (json/text/arrayBuffer/blob/formData/body) goes through here.
          let stream = Readable.toWeb(this._incoming) as any
          if (this._bodyLimit !== null) {
            const incoming = this._incoming
            stream = limitStream(stream, this._bodyLimit, () => drainIncoming(incoming))
          }
          init.body = stream
          ;(init as any).duplex = 'half'
        }
      }
      if (this._abortController) {
        init.signal = this._abortController.signal
      }
      this._real = new GlobalRequest(this.url, init)
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
    // Stream path - fallback to _getReal().body (Readable.toWeb)
    const method = this._incoming.method || 'GET'
    if (method === 'GET' || method === 'HEAD') return null
    return this._getReal().body
  },
  get bodyUsed() {
    return this._bodyBuffer !== null || (this._real?.bodyUsed ?? false)
  },

  // Rare path - delegate to real Request
  blob() {
    return this._getReal().blob()
  },
  formData() {
    return this._getReal().formData() // needs Content-Type boundary parsing
  },
  clone() {
    return this._getReal().clone()
  },

  // ── Static properties (spec-compliant defaults) ────────────

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
  incoming: IncomingMessage,
  hostname: string,
  port: number,
  pathname: string,
  search: string,
): Request {
  const proxy = Object.create(requestProto)
  proxy._incoming = incoming
  proxy._hostname = hostname
  proxy._port = port
  proxy._pathname = pathname
  proxy._search = search
  proxy._url = null
  proxy._headerPairs = null
  proxy._headers = null
  proxy._real = null
  proxy._abortController = null
  proxy._ensureCloseListener = null
  proxy._bodyPromise = null
  proxy._bodyBuffer = null
  proxy._bodyStream = null
  proxy._bodyReject = null
  proxy._bodyLimit = null
  return proxy as any
}

// ─── Cached Response (LightResponse) ─────────────────────────
//
// Replaces globalThis.Response. For string/null/Uint8Array bodies,
// stores [status, body, headers] in CACHE symbol - no GlobalResponse
// created. Adapter reads CACHE directly for writeHead + end.

const GlobalRequest = globalThis.Request
const GlobalResponse = globalThis.Response

class LightResponse {
  #body: any
  #init: any
  #real?: InstanceType<typeof GlobalResponse>;

  [CACHE]?: [number, any, any]

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this.#body = body ?? null
    this.#init = init
    if (body === null || typeof body === 'string' || body instanceof Uint8Array) {
      this[CACHE] = [init?.status ?? 200, body, init?.headers]
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
      const h = this[CACHE]![2]
      if (!(h instanceof Headers)) {
        this[CACHE]![2] = new Headers(h ?? {})
      }
      return this[CACHE]![2] as Headers
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

  static json(data: any, init?: ResponseInit): LightResponse {
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

// ─── Response Writer ─────────────────────────────────────────

/** Convert Headers to plain object, preserving duplicate keys (e.g. Set-Cookie) as arrays. */
function headersToObject(headers: Headers): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  headers.forEach((value, key) => {
    const existing = result[key]
    if (existing === undefined) {
      result[key] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      result[key] = [existing, value]
    }
  })
  return result
}

/** Fast path: write cached response directly (writeHead + end). Fallback: streaming. */
function sendResponse(nodeRes: ServerResponse, response: any): void {
  if (nodeRes.closed || nodeRes.writableEnded) return

  const cached = response[CACHE]
  if (cached) {
    const [status, body, headers] = cached
    if (Array.isArray(headers)) {
      for (const [k, v] of headers as [string, string][]) nodeRes.appendHeader(k, v)
      if (body !== null && !nodeRes.hasHeader('content-length')) {
        nodeRes.setHeader('Content-Length', typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength)
      }
      nodeRes.writeHead(status)
    } else if (headers instanceof Headers || !headers) {
      // Fast path: Headers Web API normalizes keys to lowercase, so
      // single hash lookup is correct - case-ambiguity impossible.
      const headerObj = headers ? headersToObject(headers) : {}
      if (body !== null && !headerObj['content-length']) {
        headerObj['Content-Length'] = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
      }
      nodeRes.writeHead(status, headerObj)
    } else {
      // Plain object: case-sensitive in JS. Use Node setHeader API for
      // case-insensitive correctness (avoids overwriting user's
      // 'CONTENT-LENGTH', 'Content-length' etc.).
      for (const k in headers) nodeRes.setHeader(k, headers[k])
      if (body !== null && !nodeRes.hasHeader('content-length')) {
        nodeRes.setHeader('Content-Length', typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength)
      }
      nodeRes.writeHead(status)
    }
    nodeRes.end(body)
    return
  }
  sendFullResponse(nodeRes, response)
}

/** Streaming fallback: read body via ReadableStream reader loop */
async function sendFullResponse(nodeRes: ServerResponse, response: Response): Promise<void> {
  if (nodeRes.closed || nodeRes.writableEnded) return

  nodeRes.writeHead(response.status, headersToObject(response.headers))

  if (!response.body) {
    nodeRes.end()
    return
  }

  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (nodeRes.closed || nodeRes.writableEnded) break
      nodeRes.write(value)
    }
  } finally {
    reader.releaseLock()
    if (!nodeRes.writableEnded) nodeRes.end()
  }
}

function sendError(nodeRes: ServerResponse, error: unknown, logger: LoggerLike): void {
  if (nodeRes.headersSent || nodeRes.closed) return
  logger.error('Unhandled error', error instanceof Error ? (error.stack ?? error.message) : String(error), 'NodeServer')
  nodeRes.writeHead(500, { 'Content-Type': 'application/json' })
  nodeRes.end(JSON.stringify({ statusCode: 500, error: 'Internal Server Error', message: 'Internal Server Error' }))
}

function send413(nodeRes: ServerResponse): void {
  if (nodeRes.headersSent || nodeRes.closed) return
  nodeRes.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' })
  nodeRes.end(JSON.stringify({ statusCode: 413, error: 'Payload Too Large', message: 'Payload Too Large' }))
}

/** Recognized by @miiajs/core's error handler and mapped to a 413 response. */
function payloadTooLargeError(limit: number): Error {
  const err = new Error(`Request body exceeded ${limit} byte limit`)
  err.name = 'PayloadTooLargeError'
  return err
}

/**
 * Caps a body stream at `limit` bytes. On exceed, errors only the
 * consumer-facing side (req.text()/json() reject with PayloadTooLargeError)
 * WITHOUT cancelling the source: cancelling Readable.toWeb destroys the
 * underlying socket, which would kill the 413 response the handler is about
 * to send. `onExceed` (drainIncoming) disposes of the connection instead -
 * after the response is written.
 */
function limitStream(
  source: ReadableStream<Uint8Array>,
  limit: number,
  onExceed: () => void,
): ReadableStream<Uint8Array> {
  let total = 0
  const reader = source.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      total += value.byteLength
      if (total > limit) {
        controller.error(payloadTooLargeError(limit))
        reader.releaseLock()
        onExceed()
        return
      }
      controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

// ─── Incoming Drain ──────────────────────────────────────────
//
// Drain unconsumed request body to allow connection reuse (keep-alive).
// Timeout prevents hanging on slow/stalled clients. Limit prevents OOM.

const DRAIN_TIMEOUT = 500
const MAX_DRAIN_BYTES = 64 * 1024 * 1024

function drainIncoming(incoming: IncomingMessage): void {
  if (incoming.readableEnded || incoming.destroyed) return

  let drained = 0
  const timer = setTimeout(() => {
    cleanup()
    if (!incoming.readableEnded && !incoming.destroyed) {
      incoming.destroy()
    }
  }, DRAIN_TIMEOUT)
  timer.unref?.()

  const cleanup = () => {
    clearTimeout(timer)
    incoming.removeListener('data', onData)
    incoming.removeListener('end', cleanup)
    incoming.removeListener('error', cleanup)
  }
  const onData = (chunk: Buffer) => {
    drained += chunk.length
    if (drained > MAX_DRAIN_BYTES) {
      cleanup()
      incoming.destroy()
    }
  }

  incoming.on('data', onData)
  incoming.on('end', cleanup)
  incoming.on('error', cleanup)
  incoming.resume()
}

// ─── Adapter ─────────────────────────────────────────────────

// ─── Public API ──────────────────────────────────────────────

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
   *  Larger or without Content-Length → Readable.toWeb stream. @default 102400 (100KB) */
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

export interface ServerHandle {
  close(): Promise<void>
}

export function serve(options: ServeOptions): Promise<ServerHandle> {
  const {
    fetch: handler,
    port = 3000,
    hostname = '0.0.0.0',
    mode = 'optimized',
    bufferThreshold = DEFAULT_BUFFER_THRESHOLD,
    maxBodySize = DEFAULT_MAX_BODY_SIZE,
    logger = console,
  } = options
  const native = mode === 'native'

  if (!native) {
    Object.defineProperty(globalThis, 'Response', { value: LightResponse, configurable: true })
  }

  return new Promise((resolve) => {
    const httpServer = createServer(
      native
        ? createNativeListener(handler, port, hostname, logger, maxBodySize)
        : createOptimizedListener(handler, port, hostname, bufferThreshold, logger, maxBodySize),
    )

    httpServer.listen(port, hostname, () => {
      resolve({
        close(): Promise<void> {
          if (!native) {
            Object.defineProperty(globalThis, 'Response', { value: GlobalResponse, configurable: true })
          }
          return new Promise((res, rej) => {
            httpServer.close((err) => (err ? rej(err) : res()))
          })
        },
      })
    })
  })
}

// ─── Optimized Listener (default) ────────────────────────────
//
// Lazy Request proxy, cached LightResponse, sync fast path.

function createOptimizedListener(
  handler: (req: Request) => Response | Promise<Response>,
  port: number,
  hostname: string,
  bufferThreshold: number,
  logger: LoggerLike,
  maxBodySize: number | false,
) {
  return (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    try {
      const rawUrl = nodeReq.url ?? '/'
      const qIdx = rawUrl.indexOf('?')
      const pathname = qIdx === -1 ? rawUrl : rawUrl.substring(0, qIdx)
      const search = qIdx === -1 ? '' : rawUrl.substring(qIdx + 1)
      const req = createRequestProxy(nodeReq, hostname, port, pathname, search) as any
      const method = nodeReq.method || 'GET'
      const hasBody = method !== 'GET' && method !== 'HEAD'

      const clHeader = nodeReq.headers['content-length']
      const cl = clHeader != null ? +clHeader : -1
      const shouldBuffer = hasBody && cl >= 0 && cl <= bufferThreshold

      // ── Early 413: declared Content-Length over the cap, handler never runs ──
      if (maxBodySize !== false && hasBody && cl > maxBodySize) {
        send413(nodeRes)
        drainIncoming(nodeReq)
        return
      }

      let closeListenerRegistered = false
      const ensureCloseListener = () => {
        if (closeListenerRegistered) return
        closeListenerRegistered = true
        nodeRes.on('close', () => {
          if (req._abortController && !req._abortController.signal.aborted) {
            req._abortController.abort(nodeReq.errored ?? new Error('Client connection closed'))
          }
          if (req._bodyReject) {
            req._bodyReject(new Error('Client connection closed'))
            req._bodyReject = null
          }
          drainIncoming(nodeReq)
        })
      }

      if (shouldBuffer) {
        // ── Buffer path: small body with known Content-Length ──
        req._bodyPromise = new Promise<Uint8Array>((resolve, reject) => {
          req._bodyReject = reject
          let single: Buffer | null = null
          let chunks: Buffer[] | null = null
          let totalLen = 0

          nodeReq.on('data', (chunk: Buffer) => {
            totalLen += chunk.length
            if (totalLen > bufferThreshold) {
              reject(new Error(`Body size ${totalLen} exceeded buffer threshold ${bufferThreshold}`))
              return
            }
            if (single === null && chunks === null) {
              single = chunk
            } else {
              if (!chunks) {
                chunks = [single!, chunk]
                single = null
              } else {
                chunks.push(chunk)
              }
            }
          })
          nodeReq.on('end', () => {
            req._bodyReject = null
            if (totalLen === 0) resolve(EMPTY_U8)
            else if (single) resolve(new Uint8Array(single.buffer, single.byteOffset, single.byteLength))
            else {
              const combined = Buffer.concat(chunks!)
              resolve(new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength))
            }
          })
          nodeReq.on('error', (err) => reject(err))
        })
        req._bodyPromise.catch(() => {}) // prevent unhandled rejection if handler never reads body
        ensureCloseListener()
      } else if (hasBody) {
        // ── Stream path: large body, no Content-Length ──
        // Chunked bodies can't be pre-checked - cap them in-stream. CL-framed
        // bodies are bounded by Node's parser and were pre-checked above.
        // `!(cl >= 0)`, not `cl < 0`: a malformed header yields cl = NaN, for
        // which both the early 413 and `cl < 0` are false.
        if (maxBodySize !== false && !(cl >= 0)) req._bodyLimit = maxBodySize
        ensureCloseListener()
      } else {
        req._ensureCloseListener = ensureCloseListener
      }

      const result = handler(req)

      if (result instanceof Promise) {
        result.then(
          (res) => sendResponse(nodeRes, res),
          (err) => sendError(nodeRes, err, logger),
        )
      } else {
        sendResponse(nodeRes, result)
      }
    } catch (error) {
      sendError(nodeRes, error, logger)
    }
  }
}

// ─── Native Listener ─────────────────────────────────────────
//
// Standard Web API Request/Response. No global overrides, no proxies.
// Compatible with any code that relies on instanceof checks.

function createNativeListener(
  handler: (req: Request) => Response | Promise<Response>,
  port: number,
  hostname: string,
  logger: LoggerLike,
  maxBodySize: number | false,
) {
  return async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    try {
      const method = (nodeReq.method ?? 'GET').toUpperCase()
      if (maxBodySize !== false && method !== 'GET' && method !== 'HEAD') {
        const clHeader = nodeReq.headers['content-length']
        if (clHeader != null && +clHeader > maxBodySize) {
          send413(nodeRes)
          drainIncoming(nodeReq)
          return
        }
      }
      const request = toWebRequest(nodeReq, port, hostname, maxBodySize)
      const response = await handler(request)
      await sendFullResponse(nodeRes, response)
    } catch (error) {
      sendError(nodeRes, error, logger)
    }
  }
}

function toWebRequest(nodeReq: IncomingMessage, port: number, hostname: string, maxBodySize: number | false): Request {
  const host = nodeReq.headers.host ?? `${hostname}:${port}`
  const url = `http://${host}${nodeReq.url ?? '/'}`

  const headers = new Headers()
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }

  const method = (nodeReq.method ?? 'GET').toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'

  let body = hasBody ? (Readable.toWeb(nodeReq) as any) : undefined
  // Cap chunked bodies in-stream (no Content-Length to pre-check; oversized
  // declared lengths were already rejected in the listener).
  if (body && maxBodySize !== false && nodeReq.headers['content-length'] == null) {
    body = limitStream(body, maxBodySize, () => drainIncoming(nodeReq))
  }

  return new GlobalRequest(url, {
    method,
    headers,
    body,
    // @ts-expect-error - duplex is required for streaming bodies in Node 20+
    duplex: hasBody ? 'half' : undefined,
  })
}
