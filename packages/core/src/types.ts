import type { ResponseBuilder } from './response.js'
import type { LoggerService } from './logger.js'

// ─── Utility Types ───────────────────────────────────────────────

export type Constructor<T = any> = new (...args: any[]) => T

export type Resolve = <T>(token: Constructor<T> | string) => T

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
   * Returns the parsed JSON body, cached per request.
   * After `@ValidateBody` runs, returns the validated (and possibly transformed) data.
   *
   * Only one body-consumption method (`json()` or `text()`) can be used per request.
   * Cross-format calls may work on node-server/uws-server for small bodies
   * (≤ `bufferThreshold`) due to the buffered fast path, but this is an adapter
   * optimization detail - do not rely on it. On Bun/Deno or streaming bodies,
   * the second call will throw "body already used".
   */
  json<T = any>(): Promise<T>
  /**
   * Returns the raw request body as text, cached per request.
   *
   * Same single-consumption caveats as `json()` apply.
   */
  text(): Promise<string>
  /** @internal Used by `@ValidateBody` to replace the cached parsed body. */
  _setBody(value: unknown): void
}

// ─── Middleware & Guards ─────────────────────────────────────────

export type Middleware = (ctx: RequestContext, next: () => Promise<void>) => void | Promise<void>

export interface CanActivate {
  canActivate(ctx: RequestContext): boolean | Promise<boolean>
}

export type Guard = Constructor<CanActivate>

// ─── DI Providers ────────────────────────────────────────────────

export interface FactoryProvider<T = unknown> {
  token: string | Constructor
  factory: ((resolve: Resolve) => T) | (() => T)
  scope?: Scope
}

export type ProviderDefinition = Constructor | FactoryProvider

// ─── Module System ───────────────────────────────────────────────

export interface ModuleOptions {
  imports?: (Constructor | ConfiguredModule)[]
  controllers?: Constructor[]
  providers?: ProviderDefinition[]
  prefix?: string
}

export interface ConfiguredModule {
  module: Constructor
  providers?: ProviderDefinition[]
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
   */
  maxBodySize?: number | false
}

export interface ServerHandle {
  close(): void | Promise<void>
}

export type ListenAdapter = (info: ListenInfo) => void | ServerHandle | Promise<void> | Promise<ServerHandle>
