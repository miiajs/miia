import type { CookieJar } from './cookies.js'
import type { ResponseBuilder } from './response.js'
import type { LoggerService } from './logger.js'
import type { FORWARD_REF } from './app/forward-ref.js'

// ─── Utility Types ───────────────────────────────────────────────

export type Constructor<T = any> = new (...args: any[]) => T

export type AbstractConstructor<T = any> = abstract new (...args: any[]) => T

declare const TOKEN_BRAND: unique symbol

/** A typed DI token. Identity is the object itself; `name` is for messages only. */
export interface Token<T> {
  readonly name: string
  readonly hint?: string
  readonly [TOKEN_BRAND]: T
}

export type AnyToken = Token<any> | AbstractConstructor

export type Resolve = <T>(token: Token<T> | AbstractConstructor<T>) => T

export type Scope = 'singleton' | 'transient' | 'request'

// ─── Request Context ─────────────────────────────────────────────

export interface ConnInfo {
  remoteAddress?: string
  remotePort?: number
  family?: 'IPv4' | 'IPv6'
}

export interface RequestContext {
  req: Request
  res: ResponseBuilder
  params: Record<string, any>
  query: Record<string, any>
  rawQuery: URLSearchParams
  /**
   * Connection info for the request, resolved lazily and cached. `{}` when the
   * runtime exposes no socket address (e.g. unit tests without `_conn`). The
   * `remoteAddress` is always the honest socket IP, never a proxy header.
   */
  readonly conn: ConnInfo
  /**
   * Client IP. Resolves from trusted proxy headers when `trustProxy` is set
   * (see `MiiaOptions.trustProxy`), otherwise falls back to `conn.remoteAddress`.
   */
  readonly ip: string | undefined
  /**
   * Cookie accessor, resolved lazily and cached. Reads incoming cookies from the
   * request `Cookie` header (`get`/`getAll`/`has`) and writes response cookies
   * (`set`/`delete`) through the `ResponseBuilder`.
   */
  readonly cookies: CookieJar
  /**
   * Returns the parsed JSON body, cached per request.
   * After the route's `body` schema runs, returns the validated (and possibly transformed) data.
   *
   * Reads the body through `text()`. An empty body (or none, e.g. a GET) resolves to
   * `undefined`; a body that is not valid JSON rejects with `BadRequestException` (400).
   * `json()` and `text()` share one read and can be combined in any order. The raw
   * stream (`req.body`, `req.formData()`, `req.arrayBuffer()`) is available only
   * before the first call to either.
   */
  json<T = any>(): Promise<T>
  /**
   * Returns the raw request body as text, cached per request.
   *
   * Shares its read with `json()`. After the route's `body` schema runs it still
   * returns the raw text, not the validated data.
   */
  text(): Promise<string>
  /**
   * Resolves a provider for this request. Request-scoped providers are created once per
   * request and cached on the context; singletons and transients resolve as usual.
   * This is the only way to reach a request-scoped provider from a handler, middleware or guard.
   */
  resolve<T>(token: Token<T> | AbstractConstructor<T>): T
  /** @internal Used by the built-in JSON body reader to store validated data. */
  _setBody(value: unknown): void
}

// ─── Middleware & Guards ─────────────────────────────────────────

export type Middleware = (ctx: RequestContext, next: () => Promise<void>) => void | Promise<void>

export interface CanActivate {
  canActivate(ctx: RequestContext): boolean | Promise<boolean>
}

export type Guard = Constructor<CanActivate>

/** A status a guard can reject with, declared on the guard class via `GUARD_RESPONSES`. */
export type GuardResponseDeclaration = number | { status: number; description?: string }

// ─── DI Providers ────────────────────────────────────────────────

export interface FactoryProvider<T = unknown> {
  token: Token<T> | AbstractConstructor<T>
  factory: ((resolve: Resolve) => T) | (() => T)
  scope?: Scope
  /**
   * Singletons whose lifecycle hooks must run before this provider's. Needed only for a dependency the factory
   * reaches lazily, after construction - a `resolve()` call inside the factory itself is already seen by the container.
   */
  deps?: readonly AnyToken[]
}

export type ProviderDefinition = Constructor | FactoryProvider

// ─── Module System ───────────────────────────────────────────────

/** A module reference resolved when the graph loads, from `forwardRef(() => X)`. */
export interface ForwardRef<T> {
  readonly [FORWARD_REF]: () => T
}

export type ModuleRef = Constructor | ConfiguredModule | ForwardRef<Constructor | ConfiguredModule>

export interface ModuleOptions {
  imports?: ModuleRef[]
  controllers?: Constructor[]
  providers?: ProviderDefinition[]
  /** What importers of this module see: its own providers, and modules it imports (re-export). */
  exports?: (AnyToken | ConfiguredModule | ForwardRef<Constructor | ConfiguredModule>)[]
  /** The exports of a global module are seen by every module, without an import. */
  global?: boolean
  prefix?: string
}

export interface ConfiguredModule {
  module: Constructor
  providers?: ProviderDefinition[]
  /**
   * The providers importers see. Without `exports` the module exports nothing. Merged with
   * `@Module({ exports })` of `module` as a union.
   */
  exports?: AnyToken[]
  /** Merged with `@Module({ global })` of `module`: global when either says so. */
  global?: boolean
  /**
   * The identity of a configured module is the pair (`module`, `name`); two `configure()`
   * calls with the same pair are an error. A bare import of `module` resolves to the
   * configured one without a name.
   */
  name?: string
}

// ─── Validation (Zod-compatible) ─────────────────────────────────

export interface ZodLikeIssue {
  path?: PropertyKey[]
  message: string
  code?: string
}

export interface ZodLike<T = any> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: ZodLikeIssue[] } }
}

/** Request schemas for a route that takes a body: POST, PUT, PATCH, DELETE. */
export interface RouteOptions {
  body?: ZodLike
  query?: ZodLike
  params?: ZodLike
}

/** Request schemas for GET, HEAD and OPTIONS, which take no body. */
export interface RouteOptionsWithoutBody {
  query?: ZodLike
  params?: ZodLike
  body?: never
}

export interface BodyReader {
  /** Media type for the spec, e.g. 'multipart/form-data'. */
  contentType: string
  /** Reads the raw body into the value the schema validates. */
  read(ctx: RequestContext): Promise<unknown>
  /** Stores validated data so the handler's own accessor returns it. */
  commit(ctx: RequestContext, data: unknown): void
}

// ─── Route Metadata ──────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface RouteDefinition {
  method: HttpMethod
  path: string
  handlerName: string
}

// ─── Listen / Server ────────────────────────────────────────────

export interface ListenInfo {
  port: number
  hostname: string
  fetch: (req: Request) => Response | Promise<Response>
  logger?: LoggerService
  /**
   * Adapter-level body cap computed by Miia: max(app `maxBodySize`, all
   * `@BodyLimit` values), or `false` when limits are disabled. Adapters fall
   * back to their own 1 MiB default when undefined (standalone serve() usage).
   *
   * It is a ceiling, not the last word: for a body with no declared length,
   * core narrows an adapter's `_bodyLimit` to the matched route's own limit
   * once routing has happened, and never widens what the adapter already set.
   */
  maxBodySize?: number | false
}

export interface ServerHandle {
  close(): void | Promise<void>
}

export type ListenAdapter = (info: ListenInfo) => void | ServerHandle | Promise<void> | Promise<ServerHandle>
