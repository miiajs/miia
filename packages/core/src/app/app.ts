import { applyBodyCeiling, DEFAULT_BODY_LIMIT } from '../body-limit.js'
import { Container } from '../di-container.js'
import { DiscoveryService } from '../discovery/index.js'
import { type GlobalGuardBinding, type MatchResult, Router } from '../router.js'
import { compose, guardToMiddleware } from '../middleware.js'
import { ResponseBuilder } from '../response.js'
import { Resolver } from '../resolver.js'
import { HttpException, InternalServerException, NotFoundException, PayloadTooLargeException } from '../exceptions.js'
import type { LoggerConfig, LoggerService } from '../logger.js'
import { ConsoleLogger, Logger } from '../logger.js'
import { ModuleLoader } from './module-loader.js'
import type {
  CanActivate,
  ConfiguredModule,
  Constructor,
  Guard,
  HttpMethod,
  ListenAdapter,
  Middleware,
  RequestContext,
  ServerHandle,
} from '../types.js'

// ─── Options ─────────────────────────────────────────────────────

export interface MiiaOptions {
  logger?: LoggerService | LoggerConfig | false
  /**
   * Register process signal handlers that gracefully call `destroy()` when
   * the process receives SIGTERM/SIGINT/SIGHUP. Registered on first `listen()`
   * call (not in the constructor) so embedded `app.fetch` use cases (e.g. for
   * serverless) do not pick up global handlers.
   *
   * - `true` (default) - register handlers for `['SIGTERM', 'SIGINT', 'SIGHUP']`
   * - `false` - do not register; user is responsible for calling `destroy()`
   * - `NodeJS.Signals[]` - custom subset of signals (empty array is equivalent
   *   to `false` - no signals registered)
   *
   * On signal: logs `Received <signal>, shutting down gracefully...`,
   * awaits `destroy()`, exits with code 0 (or 1 if destroy throws).
   * Concurrent signals are guarded - only the first one initiates shutdown.
   *
   * Notes:
   * - `process.exit(0)` after `destroy()` cancels non-awaited timers and any
   *   remaining open handles. Acceptable trade-off for deterministic exit.
   * - Pressing Ctrl+C twice: the first SIGINT triggers Miia shutdown, after
   *   which the handler is gone (`process.once`); the second SIGINT goes to
   *   the OS default action (process kill). This is conventional Unix
   *   behaviour, not a bug.
   * - Existing user `process.on('SIGTERM', ...)` listeners co-exist with
   *   Miia's; both fire on signal. Pass `shutdownHooks: false` to opt out
   *   if you fully manage shutdown yourself.
   * - Windows: SIGHUP is not supported. The default array filters it out
   *   silently on win32; SIGTERM/SIGINT still active.
   * - `TestApp` does not call `listen()`, so handlers are never registered
   *   in tests - safe by construction.
   * - Multi-Miia (multiple instances in one process): all instances receive
   *   the signal and start their own `destroy()` concurrently. The first to
   *   reach `process.exit(0)` terminates the process; others' cleanup may
   *   be interrupted mid-flight. Pass `shutdownHooks: false` on secondary
   *   instances and have the primary tear them down manually before its
   *   own `destroy()`.
   */
  shutdownHooks?: boolean | NodeJS.Signals[]
  /**
   * Maximum request body size in bytes for non-GET/HEAD requests. Per-route
   * `@BodyLimit()` overrides this (method > class > this option). `false`
   * disables the default limit and the adapter-level cap.
   *
   * Declared Content-Length is checked in core after route matching against
   * the per-route limit. Chunked bodies (no Content-Length) are capped by the
   * adapter ceiling - `max(maxBodySize, all @BodyLimit values)` - enforced
   * natively on Bun (`maxRequestBodySize`), via a counting stream wrapper on
   * Deno, and by the node-server/uws-server adapters.
   *
   * @default 1_048_576 (1 MiB)
   */
  maxBodySize?: number | false
}

const JSON_RESPONSE_INIT = Object.freeze({
  status: 200,
  headers: Object.freeze({ 'Content-Type': 'application/json' }),
})

// Stripped from merged headers on the error path: stale values would mis-describe
// the fresh JSON error envelope and cause clients to mis-parse or hang.
const BODY_HEADERS_TO_STRIP = ['content-type', 'content-length', 'content-encoding', 'transfer-encoding'] as const

// ─── Miia Application ───────────────────────────────────────

/**
 * Top-level application entry point.
 *
 * **Graceful shutdown.** When `listen()` is called, Miia registers SIGTERM,
 * SIGINT, and SIGHUP handlers that gracefully call `destroy()` and
 * `process.exit(0)`. This ensures `onDestroy` lifecycle hooks (database
 * disconnects, broker cleanup, drain) run on Ctrl+C and on container
 * orchestrator stops (K8s, Docker, systemd).
 *
 * For embedded use cases (serverless via `app.fetch`, multi-Miia processes,
 * custom bootstrap), opt out via `new Miia({ shutdownHooks: false })` and
 * call `destroy()` manually. `TestApp` does not register handlers because
 * it never calls `listen()`.
 *
 * See `MiiaOptions.shutdownHooks` for full behavioural details.
 */
export class Miia {
  private container = new Container()
  private router = new Router()
  private globalMiddlewares: Middleware[] = []
  private globalGuards: Guard[] = []
  private moduleLoader: ModuleLoader
  private initialized = false
  private initPromise?: Promise<void>
  private compiled = false
  private compiledGlobalPipeline?: Middleware
  private closeServer?: () => void | Promise<void>
  private logger: Logger
  private shutdownHooksOption: boolean | NodeJS.Signals[]
  private shutdownHandlersRegistered = false
  private shutdownInProgress = false
  /**
   * Tracks listeners we registered so destroy() can `process.off()` them
   * symmetrically. Without this, every Miia instance that calls listen()
   * leaks 3 process listeners (SIGTERM/SIGINT/SIGHUP) - test runs add up
   * fast and Node will warn MaxListenersExceededWarning after ~10 tests.
   */
  private registeredShutdownHandlers: Array<{ signal: NodeJS.Signals; listener: NodeJS.SignalsListener }> = []

  constructor(options?: MiiaOptions) {
    if (options?.logger === false) {
      Logger.setLogger({
        log() {},
        error() {},
        warn() {},
      })
    } else if (options?.logger) {
      Logger.setLogger(this.isLoggerService(options.logger) ? options.logger : new ConsoleLogger(options.logger))
    }
    this.logger = new Logger('App')
    this.shutdownHooksOption = options?.shutdownHooks ?? true
    // Before any register() call, so every route registration (including
    // programmatic ones like swagger's onReady) resolves against this default.
    this.router.defaultBodyLimit = options?.maxBodySize ?? DEFAULT_BODY_LIMIT
    this.moduleLoader = new ModuleLoader(this.router, this.container)

    // Auto-register DiscoveryService so any provider can inject it without
    // explicit module registration. Factory closure captures `this.container`
    // - keeps Container encapsulated (not self-injectable).
    this.container.register(DiscoveryService, () => new DiscoveryService(this.container), 'singleton')

    // Expose Router via DI so providers can programmatically register routes
    // (e.g. @miiajs/swagger does this inside onReady()).
    this.container.register(Router, () => this.router, 'singleton')

    // Public DI introspection API. Read-only wrapper over Container so user
    // code can inspect provider registration without exposing register/destroy.
    this.container.register(Resolver, () => new Resolver(this.container), 'singleton')
  }

  use(...middlewares: Middleware[]): this {
    this.globalMiddlewares.push(...middlewares)
    this.compiled = false
    return this
  }

  useGuard(...guards: Guard[]): this {
    this.globalGuards.push(...guards)
    this.compiled = false
    return this
  }

  register(...modules: (Constructor | ConfiguredModule)[]): this {
    this.moduleLoader.load(...modules)
    this.compiled = false
    return this
  }

  addRoute(
    method: HttpMethod,
    path: string,
    handler: (ctx: RequestContext) => unknown,
    middlewares: Middleware[] = [],
  ): this {
    this.router.add(method, path, handler, { middlewares })
    this.compiled = false
    return this
  }

  get<T>(token: Constructor<T> | string): T {
    return this.container.resolve<T>(token)
  }

  fetch = (req: Request): Response | Promise<Response> => {
    if (!this.initialized) return this.initAndFetch(req)
    if (!this.compiled) this.compilePipelines()

    const r = req as Request & { _pathname?: string; _search?: string }
    let pathname: string, search: string
    if (r._pathname !== undefined) {
      pathname = r._pathname
      search = r._search ?? ''
    } else {
      const parsed = fastUrlParse(req.url)
      pathname = parsed.pathname
      search = parsed.search
    }
    const ctx = new Context(req, search)

    // Slow path: global middleware wraps router.match + per-route pipeline + handler.
    // Errors (including NotFoundException from router) bubble through the onion so
    // global middleware can observe them via try/catch around `await next()`.
    if (this.compiledGlobalPipeline !== undefined) {
      return this.handleWithGlobalPipeline(this.compiledGlobalPipeline, pathname, ctx, req)
    }

    const matched = this.router.match(req.method, pathname)

    if (!matched) {
      return this.handleError(new NotFoundException(`Cannot ${req.method} ${pathname}`), req)
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && matched.bodyLimit !== false) {
      const tooLarge = this.checkBodyLimit(req, matched.bodyLimit)
      if (tooLarge) return this.handleError(tooLarge, req, ctx)
    }

    ctx.params = matched.params

    // Has per-route middleware → async path
    if (matched.compiledPipeline) {
      return this.handleWithPipeline(matched, ctx, req)
    }

    // Sync fast path - no global pipeline, no per-route pipeline
    try {
      const result = matched.handler(ctx)

      if (result instanceof Promise) {
        return result
          .then((value) => {
            if (value != null && !(value instanceof Response) && !ctx.res._modified && req.method !== 'HEAD') {
              return new Response(JSON.stringify(value), JSON_RESPONSE_INIT)
            }
            return this.finalizeResponse(value, ctx, req)
          })
          .catch((error) => this.handleError(error, req, ctx))
          .finally(() => this.container.clearRequestScope())
      }

      // Inline JSON fast path
      if (result != null && !(result instanceof Response) && !ctx.res._modified && req.method !== 'HEAD') {
        this.container.clearRequestScope()
        return new Response(JSON.stringify(result), JSON_RESPONSE_INIT)
      }

      const response = this.finalizeResponse(result, ctx, req)
      this.container.clearRequestScope()
      return response
    } catch (error) {
      this.container.clearRequestScope()
      return this.handleError(error, req, ctx)
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return
    return (this.initPromise ??= this.doInit())
  }

  private async doInit(): Promise<void> {
    await this.container.initAll()
    this.compilePipelines()
    await this.container.bootstrapAll()
    this.initialized = true
  }

  listen(port: number): Promise<void>
  listen(port: number, hostname: string): Promise<void>
  listen(port: number, adapter: ListenAdapter): Promise<void>
  listen(port: number, hostname: string, adapter: ListenAdapter): Promise<void>
  async listen(port: number, hostnameOrAdapter?: string | ListenAdapter, adapter?: ListenAdapter): Promise<void> {
    const hostname = typeof hostnameOrAdapter === 'string' ? hostnameOrAdapter : '0.0.0.0'
    const cb = typeof hostnameOrAdapter === 'function' ? hostnameOrAdapter : adapter

    await this.init()

    // Adapter-level body cap: max(app maxBodySize, all @BodyLimit values).
    // Routes are all registered by now (init() runs onReady hooks, e.g. swagger).
    const ceiling = this.router.adapterBodyCeiling

    try {
      if (cb) {
        const result = await cb({ port, hostname, fetch: this.fetch, logger: this.logger, maxBodySize: ceiling })
        if (result && typeof (result as ServerHandle).close === 'function') {
          this.closeServer = () => (result as ServerHandle).close()
        }
      } else if ('Bun' in globalThis) {
        const server = globalThis.Bun.serve({
          fetch: this.fetch,
          port,
          hostname,
          // When disabled, omit the option - Bun's own default (128MB) applies.
          ...(ceiling !== false ? { maxRequestBodySize: ceiling } : {}),
        })
        this.closeServer = () => server.stop()
      } else if ('Deno' in globalThis) {
        // Deno.serve has no body size option - cap chunked bodies (no
        // Content-Length) by re-wrapping the request with a counting stream.
        const fetchFn = ceiling === false ? this.fetch : (req: Request) => this.fetch(applyBodyCeiling(req, ceiling))
        const server = globalThis.Deno.serve(
          {
            port,
            hostname,
            onListen: () => {},
          },
          fetchFn,
        )
        this.closeServer = () => server.shutdown()
      } else {
        throw new Error(
          'No runtime detected. Pass a server adapter to listen():\n' +
            "import { serve } from '@miiajs/node-server'\n" +
            'await app.listen(3000, serve)',
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to start server on port ${port}: ${message}`)
      throw error
    }

    this.logger.log(`Listening on http://${hostname}:${port}`)

    this.registerShutdownHandlers()
  }

  async destroy(): Promise<void> {
    // Unregister signal listeners we added so repeated listen()+destroy() in
    // tests does not leak. Idempotent - no-op if registerShutdownHandlers
    // was never called or shutdownHooks: false.
    for (const { signal, listener } of this.registeredShutdownHandlers) {
      process.off(signal, listener)
    }
    this.registeredShutdownHandlers = []
    // Allow re-registration on subsequent listen() (rare reload patterns).
    this.shutdownHandlersRegistered = false

    await this.closeServer?.()
    await this.container.destroyAll()
    this.logger.log('Shutdown complete')
  }

  private registerShutdownHandlers(): void {
    if (this.shutdownHandlersRegistered) return
    if (this.shutdownHooksOption === false) return

    const requested: NodeJS.Signals[] = Array.isArray(this.shutdownHooksOption)
      ? this.shutdownHooksOption
      : ['SIGTERM', 'SIGINT', 'SIGHUP']

    // Filter platform-incompatible signals. SIGHUP is not supported on Windows
    // and process.once('SIGHUP', ...) emits a runtime warning there. Skip
    // silently rather than warn or throw - users on Windows still get
    // SIGTERM/SIGINT coverage from the default array.
    const signals = requested.filter((sig) => {
      if (process.platform === 'win32' && sig === 'SIGHUP') return false
      return true
    })

    if (signals.length === 0) return

    this.shutdownHandlersRegistered = true

    const handler = async (signal: NodeJS.Signals): Promise<void> => {
      if (this.shutdownInProgress) return
      this.shutdownInProgress = true
      this.logger.log(`Received ${signal}, shutting down gracefully...`)
      try {
        await this.destroy()
        process.exit(0)
      } catch (err) {
        this.logger.error(`Shutdown failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
        process.exit(1)
      }
    }

    for (const signal of signals) {
      const listener: NodeJS.SignalsListener = () => {
        void handler(signal)
      }
      process.once(signal, listener)
      this.registeredShutdownHandlers.push({ signal, listener })
    }
  }

  private async initAndFetch(req: Request): Promise<Response> {
    await this.init()
    return this.fetch(req)
  }

  // ─── Private ─────────────────────────────────────────────────

  private finalizeResponse(result: unknown, ctx: RequestContext, req: Request): Response {
    if (result instanceof Response) {
      if (req.method === 'HEAD') {
        return new Response(null, { status: result.status, headers: result.headers })
      }
      return result
    }

    if (req.method === 'HEAD') {
      if (result != null && !ctx.res.getHeaders().has('content-type')) {
        ctx.res.header('Content-Type', 'application/json')
      }
      return new Response(null, {
        status: ctx.res.getStatus(),
        headers: ctx.res.getHeaders(),
      })
    }

    if (result != null) {
      if (!ctx.res.getHeaders().has('content-type')) {
        ctx.res.json(result)
      }
    }

    return ctx.res.build()
  }

  private async handleWithPipeline(matched: MatchResult, ctx: RequestContext, req: Request): Promise<Response> {
    try {
      let rawResult: unknown = undefined

      await matched.compiledPipeline!(ctx, async () => {
        const result = matched.handler(ctx)
        rawResult = result instanceof Promise ? await result : result
      })

      return this.finalizePipelineResult(rawResult, ctx, req)
    } catch (error) {
      return this.handleError(error, req, ctx)
    } finally {
      this.container.clearRequestScope()
    }
  }

  private async handleWithGlobalPipeline(
    globalPipeline: Middleware,
    pathname: string,
    ctx: RequestContext,
    req: Request,
  ): Promise<Response> {
    let rawResult: unknown = undefined

    try {
      await globalPipeline(ctx, async () => {
        const matched = this.router.match(req.method, pathname)
        if (!matched) throw new NotFoundException(`Cannot ${req.method} ${pathname}`)

        if (req.method !== 'GET' && req.method !== 'HEAD' && matched.bodyLimit !== false) {
          const tooLarge = this.checkBodyLimit(req, matched.bodyLimit)
          if (tooLarge) throw tooLarge // bubbles through the global middleware onion
        }

        ctx.params = matched.params

        if (matched.compiledPipeline) {
          await matched.compiledPipeline(ctx, async () => {
            const result = matched.handler(ctx)
            rawResult = result instanceof Promise ? await result : result
          })
        } else {
          const result = matched.handler(ctx)
          rawResult = result instanceof Promise ? await result : result
        }
      })

      return this.finalizePipelineResult(rawResult, ctx, req)
    } catch (error) {
      return this.handleError(error, req, ctx)
    } finally {
      this.container.clearRequestScope()
    }
  }

  // Shared tail for both handleWithPipeline and handleWithGlobalPipeline.
  // Pure - does NOT touch the container (lifecycle owned by the caller's finally).
  private finalizePipelineResult(rawResult: unknown, ctx: RequestContext, req: Request): Response {
    // Response returned directly by handler
    if (rawResult instanceof Response) {
      if (req.method === 'HEAD') {
        return new Response(null, { status: rawResult.status, headers: rawResult.headers })
      }
      return rawResult
    }

    // Fast path: middleware didn't touch response, handler returned data
    if (rawResult != null && !ctx.res._modified && req.method !== 'HEAD') {
      return new Response(JSON.stringify(rawResult), JSON_RESPONSE_INIT)
    }

    // Normal path: middleware modified response (or handler returned null/undefined)
    if (rawResult != null && !ctx.res.getHeaders().has('content-type')) {
      ctx.res.json(rawResult)
    }

    if (req.method === 'HEAD') {
      return new Response(null, {
        status: ctx.res.getStatus(),
        headers: ctx.res.getHeaders(),
      })
    }
    return ctx.res.build()
  }

  private compilePipelines(): void {
    this.compiledGlobalPipeline = this.globalMiddlewares.length > 0 ? compose(this.globalMiddlewares) : undefined

    const globalGuards: GlobalGuardBinding[] = this.globalGuards.map((guardCtor) => {
      if (!this.container.has(guardCtor)) {
        this.container.register(guardCtor, () => new guardCtor(), 'singleton')
      }
      const instance = this.container.resolve<CanActivate>(guardCtor)
      const middleware = guardToMiddleware((ctx) => instance.canActivate(ctx))
      return { guardClass: guardCtor, middleware }
    })

    this.router.compileAll(globalGuards)
    this.compiled = true
  }

  private isLoggerService(value: LoggerService | LoggerConfig): value is LoggerService {
    return typeof (value as LoggerService).log === 'function'
  }

  private checkBodyLimit(req: Request, limit: number): PayloadTooLargeException | null {
    const cl = req.headers.get('content-length')
    // NaN comparisons are false: a malformed Content-Length falls through to
    // the adapter ceiling rather than producing a spurious 413.
    if (cl !== null && +cl > limit) {
      return new PayloadTooLargeException(`Request body of ${cl} bytes exceeds the ${limit} byte limit`)
    }
    return null
  }

  private handleError(error: unknown, req?: Request, ctx?: RequestContext): Response {
    let httpError: HttpException

    if (error instanceof HttpException) {
      httpError = error
    } else if (error instanceof Error && error.name === 'PayloadTooLargeError') {
      // Contract with @miiajs/node-server and @miiajs/uws-server: their body
      // streams error with an Error named 'PayloadTooLargeError' when the
      // adapter cap is exceeded mid-stream (chunked bodies). They do not
      // depend on core, so they cannot throw PayloadTooLargeException itself.
      httpError = new PayloadTooLargeException(error.message)
    } else {
      this.logger.error('Unhandled error', error instanceof Error ? error.stack : String(error), 'RequestHandler')
      httpError = new InternalServerException()
    }

    // Preserve middleware-set headers (CORS, X-Request-Id, tracing, Set-Cookie, ...)
    // Defensive copy - ResponseBuilder.getHeaders() returns the internal ref via ensureHeaders().
    const headers = new Headers(ctx?.res.getHeaders())
    for (const name of BODY_HEADERS_TO_STRIP) headers.delete(name)
    headers.set('Content-Type', 'application/json')

    const body = req?.method === 'HEAD' ? null : JSON.stringify(httpError.toJSON())

    return new Response(body, {
      status: httpError.statusCode,
      headers,
    })
  }
}

// Class-based RequestContext for deterministic hidden classes on hot path.
// Object literals with mixed getters/methods cause hidden-class transitions per
// property assignment in V8; a constructor with fixed field order does not.
class Context implements RequestContext {
  req: Request
  res: ResponseBuilder = new ResponseBuilder()
  params: Record<string, any> = {}
  private _search: string
  private _query: Record<string, string> | null = null
  private _rawQuery: URLSearchParams | null = null
  private _jsonPromise: Promise<unknown> | null = null
  private _textPromise: Promise<string> | null = null

  constructor(req: Request, search: string) {
    this.req = req
    this._search = search
  }

  get query(): Record<string, string> {
    if (this._query === null) {
      this._rawQuery ??= new URLSearchParams(this._search)
      this._query = Object.fromEntries(this._rawQuery)
    }
    return this._query
  }

  set query(v: Record<string, string>) {
    this._query = v
  }

  get rawQuery(): URLSearchParams {
    this._rawQuery ??= new URLSearchParams(this._search)
    return this._rawQuery
  }

  set rawQuery(v: URLSearchParams) {
    this._rawQuery = v
  }

  json<T = any>(): Promise<T> {
    return (this._jsonPromise ??= this.req.json()) as Promise<T>
  }

  text(): Promise<string> {
    return (this._textPromise ??= this.req.text())
  }

  _setBody(value: unknown): void {
    this._jsonPromise = Promise.resolve(value)
  }
}

/** Lightweight URL parse for HTTP request URLs (always have pathname, never have fragment) */
function fastUrlParse(url: string): { pathname: string; search: string } {
  const pathStart = url.indexOf('/', url.indexOf('//') + 2)
  const searchStart = url.indexOf('?', pathStart)
  if (searchStart === -1) {
    return { pathname: url.substring(pathStart), search: '' }
  }
  return {
    pathname: url.substring(pathStart, searchStart),
    search: url.substring(searchStart + 1),
  }
}
