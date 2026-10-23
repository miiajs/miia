import { applyBodyCeiling, DEFAULT_BODY_LIMIT, isBodyLimitError, isBunBodyLimitError } from '../body-limit.js'
import { CLOSED, Container, REQUEST_CONTEXT, requestContextReplaced, type ShutdownFailure } from '../di-container.js'
import { DiscoveryService } from '../discovery/index.js'
import { type AddRouteOptions, type GlobalGuardBinding, type MatchResult, Router } from '../router.js'
import { compose, guardToMiddleware, type Pipeline } from '../middleware.js'
import { ResponseBuilder } from '../response.js'
import {
  BadRequestException,
  errorBody,
  HttpException,
  InternalServerException,
  NotFoundException,
  PayloadTooLargeException,
} from '../exceptions.js'
import type { LoggerConfig, LoggerService } from '../logger.js'
import { ConsoleLogger, Logger } from '../logger.js'
import { CookieJar } from '../cookies.js'
import { getMeta, INJECTABLE } from '../decorators/index.js'
import type { InjectableMeta } from '../decorators/index.js'
import { ModuleLoader } from './module-loader.js'
import { isBoundaryReport } from './boundary-report.js'
import type { OverrideDescriptor } from './overrides.js'
import type {
  AbstractConstructor,
  AnyToken,
  CanActivate,
  ConfiguredModule,
  ConnInfo,
  Constructor,
  Guard,
  HttpMethod,
  ListenAdapter,
  Middleware,
  ProviderDefinition,
  RequestContext,
  ServerHandle,
  Token,
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
   * `destroy()` closes the server, then runs `onShutdown()` on every singleton,
   * then `onDestroy()`, both in reverse dependency order; a failing step does
   * not stop the rest - each failure is logged and `destroy()` throws at the end.
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
   * the per-route limit. A chunked body is counted as it arrives: core hands
   * the matched route's limit to whichever adapter owns the stream, and only
   * an adapter without that slot falls back to the ceiling,
   * `max(maxBodySize, all @BodyLimit values)` - enforced natively on Bun
   * (`maxRequestBodySize`) and via a counting stream wrapper on Deno.
   *
   * @default 1_048_576 (1 MiB)
   */
  maxBodySize?: number | false
  /**
   * Trust proxy headers when resolving `ctx.ip`. Enable only when behind a
   * trusted reverse proxy.
   *
   * - `true` - use the leftmost entry of `x-forwarded-for`. WARNING: the
   *   leftmost element is forgeable if the proxy appends to XFF rather than
   *   overwriting it - prefer your edge's vendor header instead.
   * - `string` / `string[]` - trusted header(s) in priority order, e.g.
   *   `'cf-connecting-ip'` or `['cf-connecting-ip', 'x-real-ip']`.
   *
   * `ctx.conn.remoteAddress` is always the honest socket IP regardless of this.
   *
   * @default false
   */
  trustProxy?: boolean | string | string[]
  /**
   * Path prefix prepended to every route the app registers - controllers,
   * `app.addRoute()`, and `serveStatic()` alike. `'api'`, `'/api'` and `'/api/'`
   * are equivalent; a route registered as `/users` is then served at `/api/users`.
   *
   * The prefix is applied inside the router and never reaches `RESOLVED_PREFIX`,
   * so `@miiajs/swagger` does not see it: the spec keeps the clean paths
   * (`/users`), and swagger's own endpoints stay at their configured `path`/
   * `uiPath`. Put the prefix into `servers` manually if the spec must carry it.
   *
   * Controller routes are resolved when the module graph is processed (first
   * `init()`, `app.get()` or `fetch()`), `addRoute()` routes on the call, and
   * both bake the prefix into the route table. Passing it here applies it to
   * every route the app will ever register.
   */
  globalPrefix?: string
}

const JSON_RESPONSE_INIT = Object.freeze({
  status: 200,
  headers: Object.freeze({ 'Content-Type': 'application/json' }),
})
// Lower case, as the error path wrote it through Headers: node-server sends a plain object's names as they are
const ERROR_HEADERS = Object.freeze({ 'content-type': 'application/json' })
const NOT_FOUND_INIT = Object.freeze({ status: 404, headers: ERROR_HEADERS })
const DONE = Promise.resolve()

// Stripped from merged headers on the error path: stale values would mis-describe
// the fresh JSON error envelope and cause clients to mis-parse or hang.
const BODY_HEADERS_TO_STRIP = ['content-type', 'content-length', 'content-encoding', 'transfer-encoding'] as const

// ─── Miia Application ───────────────────────────────────────

/**
 * Top-level application entry point.
 *
 * **Graceful shutdown.** When `listen()` is called, Miia registers SIGTERM,
 * SIGINT, and SIGHUP handlers that gracefully call `destroy()` and
 * `process.exit(0)`. This ensures the shutdown hooks run on Ctrl+C and on
 * container orchestrator stops (K8s, Docker, systemd): `onShutdown()` (stop
 * taking work, drain) on every singleton, then `onDestroy()` (database
 * disconnects, broker cleanup), both in reverse dependency order.
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
  private pendingModules: (Constructor | ConfiguredModule | OverrideDescriptor)[] = []
  private graphState: 'pending' | 'processed' | { error: unknown } = 'pending'
  private initialized = false
  private initPromise?: Promise<void>
  private compiledGlobalPipeline?: Pipeline
  private closeServer?: () => void | Promise<void>
  private logger: Logger
  /** The global logger this app put in place of `previous`, handed back by destroy(). */
  private installedLogger?: { installed: LoggerService; previous: LoggerService }
  private trustProxy: string[] | false
  private shutdownHooksOption: boolean | NodeJS.Signals[]
  private shutdownHandlersRegistered = false
  private shutdownInProgress = false
  /** The shutdown in progress: a concurrent destroy() shares it. */
  private destroying?: Promise<void>
  /**
   * Tracks listeners we registered so destroy() can `process.off()` them
   * symmetrically. Without this, every Miia instance that calls listen()
   * leaks 3 process listeners (SIGTERM/SIGINT/SIGHUP) - test runs add up
   * fast and Node will warn MaxListenersExceededWarning after ~10 tests.
   */
  private registeredShutdownHandlers: Array<{ signal: NodeJS.Signals; listener: NodeJS.SignalsListener }> = []

  constructor(options?: MiiaOptions) {
    if (options?.logger != null) {
      const installed: LoggerService =
        options.logger === false
          ? { log() {}, error() {}, warn() {} }
          : this.isLoggerService(options.logger)
            ? options.logger
            : new ConsoleLogger(options.logger)
      this.installedLogger = { installed, previous: Logger.getLogger() }
      Logger.setLogger(installed)
    }
    this.logger = new Logger('App')
    // Normalize trustProxy once: false/undefined -> false; true -> leftmost XFF;
    // string -> single trusted header; array -> lowercased copy (case-insensitive).
    this.trustProxy = normalizeTrustProxy(options?.trustProxy)
    this.shutdownHooksOption = options?.shutdownHooks ?? true
    // Before any register() call, so every route registration (including
    // programmatic ones like swagger's onReady) resolves against this default.
    this.router.defaultBodyLimit = options?.maxBodySize ?? DEFAULT_BODY_LIMIT
    // Gated on truthiness, unlike defaultBodyLimit above: an empty string means
    // no prefix, and skipping the setter keeps it out of validation too.
    if (options?.globalPrefix) this.router.globalPrefix = options.globalPrefix

    // Auto-register DiscoveryService so any provider can inject it without
    // explicit module registration. Factory closure captures `this.container`
    // - keeps Container encapsulated (not self-injectable).
    this.container.register(DiscoveryService, () => new DiscoveryService(this.container), 'singleton')

    // Expose Router via DI so providers can programmatically register routes
    // (e.g. @miiajs/swagger does this inside onReady()).
    this.container.register(Router, () => this.router, 'singleton')

    // Public DI introspection API. Read-only wrapper over Container so user
    // code can inspect provider registration without exposing register/destroy.
    // This one is bound to the root; inject(Resolver) gets one for its module.
    this.container.registerResolver()

    // Seeded into the scope of every request, so the factory never runs.
    this.container.register(
      REQUEST_CONTEXT,
      () => {
        throw new Error('[Miia] REQUEST_CONTEXT is seeded by the request')
      },
      'request',
    )
  }

  use(...middlewares: Middleware[]): this {
    this.assertNotInitialized('use')
    this.globalMiddlewares.push(...middlewares)
    return this
  }

  useGuard(...guards: Guard[]): this {
    this.assertNotInitialized('useGuard')
    this.globalGuards.push(...guards)
    return this
  }

  register(...modules: (Constructor | ConfiguredModule | OverrideDescriptor)[]): this {
    this.assertGraphPending('register')
    this.pendingModules.push(...modules)
    return this
  }

  provide(...providers: ProviderDefinition[]): this {
    this.assertGraphPending('provide')
    if (providers.some((provider) => typeof provider !== 'function' && provider.token === REQUEST_CONTEXT)) {
      throw requestContextReplaced('provide')
    }
    for (const provider of providers) {
      if (typeof provider === 'function') {
        const scope = getMeta<InjectableMeta>(provider, INJECTABLE)?.scope ?? 'singleton'
        this.container.register(provider, () => new provider(), scope)
        this.container.provided.add(provider)
      } else {
        this.container.register(provider.token, provider.factory, provider.scope, provider.deps)
        this.container.provided.add(provider.token)
      }
    }
    return this
  }

  addRoute(
    method: HttpMethod,
    path: string,
    handler: (ctx: RequestContext) => unknown,
    options: AddRouteOptions = {},
  ): this {
    this.assertNotInitialized('addRoute')
    this.router.add(method, path, handler, options)
    return this
  }

  get<T>(token: Token<T> | AbstractConstructor<T>): T {
    if (this.initPromise === undefined) {
      return this.startup(() => {
        this.processGraph()
        return this.container.resolve<T>(token)
      })
    }
    this.processGraph()
    return this.container.resolve<T>(token)
  }

  fetch = (req: Request, env?: unknown): Response | Promise<Response> => {
    if (!this.initialized) return this.initAndFetch(req, env)

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
    const ctx = new Context(req, search, env, this.trustProxy, this.container)
    const method = req.method

    // Slow path: global middleware wraps router.match + per-route pipeline + handler.
    // Errors (including NotFoundException from router) bubble through the onion so
    // global middleware can observe them via try/catch around `await next()`.
    if (this.compiledGlobalPipeline !== undefined) {
      return this.handleWithGlobalPipeline(this.compiledGlobalPipeline, pathname, ctx, method)
    }

    const matched = this.router.match(method, pathname)
    // Nothing can observe a 404 here, so it is answered without building an exception
    if (matched === null) {
      return new Response(
        method === 'HEAD' ? null : JSON.stringify(errorBody(404, `Cannot ${method} ${pathname}`)),
        NOT_FOUND_INIT,
      )
    }

    // Sync when neither the handler nor a route pipeline is async
    try {
      const result = this.runMatched(matched, ctx, method)
      if (result instanceof Promise) {
        return result.then((value) => this.respond(value, ctx, method)).catch((error) => this.fail(error, ctx))
      }
      return this.respond(result, ctx, method)
    } catch (error) {
      return this.fail(error, ctx)
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise === undefined) {
      // Assigned before doInit() starts: constructors and the first onInit() run
      // synchronously inside it, and must already see init() as begun.
      const { promise, resolve } = Promise.withResolvers<void>()
      this.initPromise = promise
      resolve(this.doInit())
    }
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    // One report for the graph, every singleton and the global guards, before the first onInit()
    this.startup(() => {
      this.processGraph()
      this.registerGlobalGuards()
      this.container.constructAll()
      this.checkGlobalGuards()
    })
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
        const server = globalThis.Deno.serve(
          {
            port,
            hostname,
            onListen: () => {},
          },
          denoListenFetch(this.fetch, ceiling),
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

  destroy(): Promise<void> {
    // Cleared when it settles: a later destroy() runs again.
    this.destroying ??= this.runDestroy().finally(() => {
      this.destroying = undefined
      this.restoreLogger()
    })
    return this.destroying
  }

  private async runDestroy(): Promise<void> {
    // Unregister signal listeners we added so repeated listen()+destroy() in
    // tests does not leak. Idempotent - no-op if registerShutdownHandlers
    // was never called or shutdownHooks: false.
    const emitter: NodeJS.EventEmitter = process
    for (const { signal, listener } of this.registeredShutdownHandlers) {
      emitter.off(signal, listener)
    }
    this.registeredShutdownHandlers = []
    // Allow re-registration on subsequent listen() (rare reload patterns).
    this.shutdownHandlersRegistered = false

    const failures: ShutdownFailure[] = []
    // Taken before the call: a second destroy() must not close the server again.
    const closeServer = this.closeServer
    this.closeServer = undefined
    try {
      await closeServer?.()
    } catch (error) {
      failures.push({ source: 'closeServer()', error })
    }
    failures.push(...(await this.container.destroyAll()))
    if (failures.length === 0) {
      this.logger.log('Shutdown complete')
      return
    }
    for (const { source, error } of failures) {
      this.logger.error(
        `${source} failed during shutdown`,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      )
    }
    if (failures.length === 1) throw failures[0]!.error
    throw new AggregateError(
      failures.map((f) => f.error),
      `[Miia] Shutdown finished with ${failures.length} errors`,
    )
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
        // Message only: destroy() has already logged each failure with its stack.
        this.logger.error(`Shutdown failed: ${err instanceof Error ? err.message : String(err)}`)
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

  private async initAndFetch(req: Request, env?: unknown): Promise<Response> {
    await this.init()
    return this.fetch(req, env)
  }

  // ─── Private ─────────────────────────────────────────────────

  /**
   * Loads every registered module once, on the first `init()` / `get()` / `fetch()`.
   * The state flips before `load()` runs, so a failed graph is never reloaded on top
   * of the loader's partial state - every later call rethrows the first error. The
   * loader is dropped after it: the container keeps the graph.
   */
  private processGraph(): void {
    const state = this.graphState
    if (state === 'processed') return
    if (state !== 'pending') throw state.error
    this.graphState = 'processed'
    try {
      new ModuleLoader(this.router, this.container).load(...this.pendingModules)
    } catch (error) {
      this.graphState = { error }
      throw error
    }
    this.pendingModules = []
  }

  /**
   * The start-up window: boundary violations are collected into one report. The report, or an error that
   * escaped with violations appended, leaves the app dead - every later init() / get() / fetch() rethrows it.
   */
  private startup<T>(fn: () => T): T {
    try {
      return this.container.collect(fn)
    } catch (error) {
      if (isBoundaryReport(error)) this.graphState = { error }
      throw error
    }
  }

  private assertGraphPending(method: string): void {
    if (this.graphState === 'pending') return
    if (this.graphState === 'processed') {
      throw new Error(
        `[Miia] ${method}() after the module graph was processed (first init(), app.get() or fetch()) - ` +
          'register all modules and providers before that',
      )
    }
    throw new Error(`[Miia] ${method}() after the module graph failed to process (see the first error)`)
  }

  // initPromise, not initialized: a call made while init() is still awaiting hooks
  // would otherwise pass and be lost, since nothing recompiles the pipelines later.
  private assertNotInitialized(method: string): void {
    if (this.initPromise !== undefined) {
      throw new Error(`[Miia] ${method}() after init() - configure the app before init()/listen()`)
    }
  }

  /**
   * Body limit, params, then the route pipeline or the bare handler. Returns the handler's result, a promise
   * of it when anything on the way is async; a 413 is thrown, so the global middleware sees it.
   */
  private runMatched(matched: MatchResult, ctx: Context, method: string): unknown {
    if (method !== 'GET' && method !== 'HEAD' && matched.bodyLimit !== false) {
      const tooLarge = this.checkBodyLimit(ctx.req, matched.bodyLimit)
      if (tooLarge) throw tooLarge
    }

    ctx.params = matched.params

    const pipeline = matched.compiledPipeline
    if (pipeline === undefined) return matched.handler(ctx)
    let result: unknown
    return pipeline(ctx, () => {
      const value = matched.handler(ctx)
      if (value instanceof Promise) {
        return value.then((v) => {
          result = v
        })
      }
      result = value
      return DONE
    }).then(() => result)
  }

  private handleWithGlobalPipeline(
    pipeline: Pipeline,
    pathname: string,
    ctx: Context,
    method: string,
  ): Promise<Response> {
    let result: unknown
    return pipeline(ctx, () => {
      const matched = this.router.match(method, pathname)
      // Rejected, not thrown: the throw would only be caught by compose() again
      if (matched === null) return Promise.reject(notFound(method, pathname))
      const value = this.runMatched(matched, ctx, method)
      if (value instanceof Promise) {
        return value.then((v) => {
          result = v
        })
      }
      result = value
      return DONE
    })
      .then(() => this.respond(result, ctx, method))
      .catch((error) => this.fail(error, ctx))
  }

  /**
   * The one place a result becomes the response, then the request scope ends. A body the handler or a
   * middleware already set is kept, under its own Content-Type, for GET and HEAD alike; HEAD never
   * serializes the result, it only gets the Content-Type a GET would. A returned `ctx.res` is no result:
   * the response is built from it.
   */
  private respond(result: unknown, ctx: Context, method: string): Response {
    const res = ctx.res
    if (result === res) result = undefined
    let response: Response
    if (result != null && !res._modified && method !== 'HEAD' && !(result instanceof Response)) {
      response = new Response(JSON.stringify(result), JSON_RESPONSE_INIT)
    } else if (result instanceof Response) {
      response = method === 'HEAD' ? new Response(null, { status: result.status, headers: result.headers }) : result
    } else {
      if (result != null && !hasBody(res)) {
        if (method !== 'HEAD') sendJson(res, result)
        else if (!res.getHeaders().has('content-type')) res.header('Content-Type', 'application/json')
      }
      response =
        method === 'HEAD' ? new Response(null, { status: res.getStatus(), headers: res.getHeaders() }) : res.build()
    }
    ctx._endScope()
    return response
  }

  /** The error response, then the request scope ends - even when building it throws. */
  private fail(error: unknown, ctx: Context): Response {
    try {
      return this.handleError(error, ctx)
    } finally {
      ctx._endScope()
    }
  }

  /** Global guards not declared in a module are built with every other singleton, before any onInit(). */
  private registerGlobalGuards(): void {
    for (const guardCtor of this.globalGuards) {
      if (!this.container.has(guardCtor)) this.container.registerGuard(guardCtor)
    }
  }

  /** From the root: a declared guard must be exported to it, what an undeclared one injected must be visible. */
  private checkGlobalGuards(): void {
    for (const guardCtor of this.globalGuards) this.container.checkGuard(guardCtor, 'root')
  }

  private compilePipelines(): void {
    this.compiledGlobalPipeline = this.globalMiddlewares.length > 0 ? compose(this.globalMiddlewares) : undefined

    const globalGuards: GlobalGuardBinding[] = this.globalGuards.map((guardCtor) => {
      const middleware = guardToMiddleware(this.container.resolve<CanActivate>(guardCtor))
      return { guardClass: guardCtor, middleware }
    })

    this.router.compileAll(globalGuards)
  }

  /** Unless something has replaced it since, the global logger goes back to what it was before this app. */
  private restoreLogger(): void {
    if (this.installedLogger === undefined) return
    if (Logger.getLogger() === this.installedLogger.installed) Logger.setLogger(this.installedLogger.previous)
    this.installedLogger = undefined
  }

  private isLoggerService(value: LoggerService | LoggerConfig): value is LoggerService {
    return typeof (value as LoggerService).log === 'function'
  }

  /**
   * Rejects a body that declares too much, and hands the route's limit to the
   * adapter for one that declares nothing.
   *
   * A chunked body has no length to check, so the limit can only be enforced
   * as the bytes arrive - and only by whoever owns the stream. Adapters that
   * build the body themselves expose a `_bodyLimit` slot for exactly that;
   * the write narrows what they already hold, never widens it. A runtime whose
   * request is a real `Request` has no slot, and keeps the adapter ceiling.
   */
  private checkBodyLimit(req: Request, limit: number): PayloadTooLargeException | null {
    const cl = req.headers.get('content-length')
    // NaN comparisons are false, so a malformed Content-Length is not rejected
    // on its face - it falls through to the byte count below.
    const declared = cl === null ? Number.NaN : +cl
    if (declared > limit) {
      return new PayloadTooLargeException(`Request body of ${cl} bytes exceeds the ${limit} byte limit`)
    }

    if (!(declared >= 0) && '_bodyLimit' in req && !req.bodyUsed) {
      const owned = req as Request & { _bodyLimit: number | null }
      owned._bodyLimit = Math.min(owned._bodyLimit ?? Number.POSITIVE_INFINITY, limit)
    }
    return null
  }

  private handleError(error: unknown, ctx: Context): Response {
    let httpError: HttpException

    if (error instanceof HttpException) {
      httpError = error
    } else if (isBodyLimitError(error)) {
      // An adapter's or Bun's body cap, exceeded mid-stream (chunked bodies)
      httpError = new PayloadTooLargeException(error.message)
    } else {
      this.logger.error('Unhandled error', error instanceof Error ? error.stack : String(error), 'RequestHandler')
      httpError = new InternalServerException()
    }

    const body = ctx.req.method === 'HEAD' ? null : JSON.stringify(httpError.toJSON())

    // Preserve middleware-set headers (CORS, X-Request-Id, tracing, Set-Cookie, ...). Edited in place, not
    // copied: the response is the last use of them, only an onDestroy() reaching ctx.res through
    // REQUEST_CONTEXT would see the edit.
    const headers = headersOf(ctx.res)
    if (headers === null) return new Response(body, { status: httpError.statusCode, headers: ERROR_HEADERS })
    for (const name of BODY_HEADERS_TO_STRIP) headers.delete(name)
    headers.set('Content-Type', 'application/json')
    return new Response(body, { status: httpError.statusCode, headers })
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
  private _env: unknown
  private _trustProxy: string[] | false
  private _connInfo: ConnInfo | null = null
  private _cookieJar: CookieJar | null = null
  private _container: Container
  /** @internal */
  _scope: Map<AnyToken, unknown> | typeof CLOSED | null = null

  constructor(req: Request, search: string, env: unknown, trustProxy: string[] | false, container: Container) {
    this.req = req
    this._search = search
    this._env = env
    this._trustProxy = trustProxy
    this._container = container
  }

  get conn(): ConnInfo {
    return (this._connInfo ??= resolveConn(this.req, this._env))
  }

  get cookies(): CookieJar {
    return (this._cookieJar ??= new CookieJar(this.req, this.res))
  }

  get ip(): string | undefined {
    if (this._trustProxy !== false) {
      for (const name of this._trustProxy) {
        const value = this.req.headers.get(name)
        if (!value) continue
        let candidate: string
        if (name === 'x-forwarded-for') {
          const comma = value.indexOf(',')
          candidate = (comma === -1 ? value : value.substring(0, comma)).trim()
        } else {
          candidate = value.trim() // vendor headers (cf-connecting-ip etc.) are single-value
        }
        if (candidate) return candidate // empty/whitespace value -> next header / socket
        // Deliberate: an empty leftmost in XFF (" , 2.2.2.2") drops the WHOLE header to the
        // next entry in the trust list / socket - we do NOT try later XFF elements (they are
        // even less trusted than the leftmost; simplicity beats heuristics on broken input).
      }
    }
    return this.conn.remoteAddress
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
    return (this._jsonPromise ??= this.text().then(parseJsonBody)) as Promise<T>
  }

  text(): Promise<string> {
    return (this._textPromise ??= this.req.text().catch((error: unknown) => {
      throw isBunBodyLimitError(error) ? new PayloadTooLargeException(error.message) : error
    }))
  }

  _setBody(value: unknown): void {
    this._jsonPromise = Promise.resolve(value)
  }

  resolve<T>(token: Token<T> | AbstractConstructor<T>): T {
    return this._container.resolveInRequest(token, this)
  }

  /** The pipeline has finished and the response is built: closes the scope, its instances get onDestroy(). @internal */
  _endScope(): void {
    const scope = this._scope
    this._scope = CLOSED
    if (scope instanceof Map) this._container.destroyRequestScope(scope, this)
  }
}

type FetchHandler = (req: Request, info?: unknown) => Response | Promise<Response>

/**
 * The app's fetch as listen() hands it to Deno. Deno.serve has no body size option, so a chunked body (no
 * Content-Length) is capped at `ceiling` by re-wrapping the request with a counting stream. Deno hands a GET or a HEAD
 * no body, so they go to the app as they are.
 * @internal Exported for tests, not from the package.
 */
export function denoListenFetch(fetch: FetchHandler, ceiling: number | false): FetchHandler {
  if (ceiling === false) return fetch
  return (req, info) =>
    req.method === 'GET' || req.method === 'HEAD' ? fetch(req, info) : fetch(applyBodyCeiling(req, ceiling), info)
}

/** Whether the handler or a middleware already gave the response a body - `_body` is private to ResponseBuilder. */
function hasBody(res: ResponseBuilder): boolean {
  return (res as unknown as { _body: BodyInit | null })._body !== null
}

/** The headers set so far, without creating them as `getHeaders()` would - `_headers` is private to ResponseBuilder. */
function headersOf(res: ResponseBuilder): Headers | null {
  return (res as unknown as { _headers: Headers | null })._headers
}

/** Whether a stack collected at limit 0 is its first line (V8: Node, Deno) or none at all (JSC: Bun). */
let firstLineStacks: boolean | undefined

/**
 * The 404 global middleware can observe. On V8 its stack is cut to the first line: collecting it walks every
 * async frame of the onion. JSC collects stacks lazily and cheaply, and writing one there costs more than
 * that, so on Bun it is built as usual - a string stack on every runtime.
 */
function notFound(method: string, pathname: string): NotFoundException {
  firstLineStacks ??= stackAtLimitZero()
  if (!firstLineStacks) return new NotFoundException(`Cannot ${method} ${pathname}`)
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    return new NotFoundException(`Cannot ${method} ${pathname}`)
  } finally {
    Error.stackTraceLimit = limit
  }
}

function stackAtLimitZero(): boolean {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    return typeof new Error().stack === 'string'
  } finally {
    Error.stackTraceLimit = limit
  }
}

/** A returned value goes out as JSON, under the Content-Type the handler set if it set one. */
function sendJson(res: ResponseBuilder, value: unknown): void {
  const type = res.getHeaders().get('content-type')
  res.json(value)
  if (type !== null) res.header('Content-Type', type)
}

/** An empty body is no body; anything else that does not parse is the client's mistake. */
function parseJsonBody(text: string): unknown {
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new BadRequestException('Malformed JSON body')
  }
}

/** Normalize the `trustProxy` option into a lowercased trusted-header list, or `false`. */
function normalizeTrustProxy(option: boolean | string | string[] | undefined): string[] | false {
  if (!option) return false
  if (option === true) return ['x-forwarded-for']
  if (typeof option === 'string') return [option.toLowerCase()]
  return option.map((h) => h.toLowerCase())
}

/**
 * Resolve socket-level connection info from the runtime, by priority:
 * 1. `req._conn` - set by node-server/uws-server adapters and TestApp;
 * 2. Bun: `env.requestIP(req)` -> `{ address, port, family }` (closed conn -> null -> `{}`);
 * 3. Deno: `env.remoteAddr` -> `{ hostname, port }`;
 * 4. otherwise `{}`.
 */
function resolveConn(req: Request, env: unknown): ConnInfo {
  const fromAdapter = (req as { _conn?: ConnInfo })._conn
  if (fromAdapter) return fromAdapter

  if (env && typeof (env as { requestIP?: unknown }).requestIP === 'function') {
    // Bun: field names differ from ConnInfo - map explicitly.
    const addr = (
      env as { requestIP: (r: Request) => { address: string; port: number; family: string } | null }
    ).requestIP(req)
    if (!addr) return {}
    return { remoteAddress: addr.address, remotePort: addr.port, family: addr.family as 'IPv4' | 'IPv6' }
  }

  const remoteAddr = (env as { remoteAddr?: { hostname?: string; port?: number } } | undefined)?.remoteAddr
  if (remoteAddr && typeof remoteAddr.hostname === 'string') {
    // Deno: ConnInfo['Addr'] with a `hostname` field.
    return {
      remoteAddress: remoteAddr.hostname,
      remotePort: remoteAddr.port,
      family: remoteAddr.hostname.includes(':') ? 'IPv6' : 'IPv4',
    }
  }

  return {}
}

/** Lightweight URL parse for HTTP request URLs (always have pathname, never have fragment) */
function fastUrlParse(url: string): { pathname: string; search: string } {
  // Bun hands a request with an invalid Host over with a relative url
  const pathStart = url.charCodeAt(0) === 47 ? 0 : url.indexOf('/', url.indexOf('//') + 2)
  const searchStart = url.indexOf('?', pathStart)
  if (searchStart === -1) {
    return { pathname: url.substring(pathStart), search: '' }
  }
  return {
    pathname: url.substring(pathStart, searchStart),
    search: url.substring(searchStart + 1),
  }
}
