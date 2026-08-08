import { DEFAULT_BODY_LIMIT } from './body-limit.js'
import { GUARD_FACTORY } from './decorators/metadata.js'
import { compose } from './middleware.js'
import type { HttpMethod, Middleware, RequestContext } from './types.js'
import { joinPaths } from './utils/index.js'

interface RouteEntry {
  method: HttpMethod
  pattern: string
  handler: (ctx: RequestContext) => unknown
  middlewares: Middleware[]
  skipGlobalGuards: boolean
  skippedGuardClasses: Set<unknown> | null
  bodyLimit: number | false
  compiledPipeline?: Middleware
}

export interface MatchResult {
  handler: (ctx: RequestContext) => unknown
  params: Record<string, string>
  bodyLimit: number | false
  compiledPipeline?: Middleware
}

export interface AddRouteOptions {
  middlewares?: Middleware[]
  /**
   * Skip all globally-registered guards (via `app.useGuard()`) for this route.
   * Global middleware from `app.use()` still applies - this opts out of guards only.
   * Used by @miiajs/swagger so UI stays reachable when the app has global auth.
   */
  skipGlobalGuards?: boolean
  /**
   * Specific global guard classes to skip for this route. Populated from `@SkipGuard`
   * metadata by RouterExplorer. Routes with `skipGlobalGuards: true` ignore this set
   * (they skip everything).
   */
  skippedGuardClasses?: Set<unknown> | null
  /**
   * Max request body size in bytes for this route (checked against the declared
   * Content-Length after matching). Defaults to `Router.defaultBodyLimit`.
   * `false` disables the check for this route.
   */
  bodyLimit?: number | false
  /**
   * Skip the app-level global prefix for this route. Used by @miiajs/swagger so the UI and
   * spec endpoints stay at their configured path, and available as an escape hatch for
   * routes that must live outside the prefix (health checks, probes).
   */
  skipGlobalPrefix?: boolean
}

export interface GlobalGuardBinding {
  guardClass: unknown
  middleware: Middleware
}

// ─── Trie ───────────────────────────────────────────────────────

interface TrieNode {
  children: Map<string, TrieNode>
  param: { name: string; node: TrieNode } | null
  wildcard: { name: string; entry: RouteEntry } | null
  entry: RouteEntry | null
}

function createNode(): TrieNode {
  return { children: new Map(), param: null, wildcard: null, entry: null }
}

// ─── Router ─────────────────────────────────────────────────────

export class Router {
  private staticRoutes = new Map<string, RouteEntry>()
  private tries = new Map<string, TrieNode>()
  private allEntries: RouteEntry[] = []

  /**
   * App default for routes registered without an explicit bodyLimit.
   * Set by Miia from `MiiaOptions.maxBodySize` before any route registration.
   */
  defaultBodyLimit: number | false = DEFAULT_BODY_LIMIT
  private maxRouteBodyLimit = 0
  private globalGuardClasses: unknown[] = []
  private prefix = ''

  /**
   * App-level path prefix prepended to every route registered without
   * `skipGlobalPrefix`. Set by Miia from `MiiaOptions.globalPrefix`; must be
   * assigned before any route is registered.
   */
  get globalPrefix(): string {
    return this.prefix
  }

  set globalPrefix(value: string) {
    if (this.allEntries.length > 0) {
      throw new Error(
        '[Miia] The global prefix must be set before any route is registered - routes are ' +
          'resolved eagerly by register()/addRoute(). Use new Miia({ globalPrefix }) instead.',
      )
    }

    // `*` would collapse the whole table onto one wildcard slot - add() returns
    // early at the wildcard branch and discards the rest of the pattern. `:`
    // would inject a param segment into every route that RESOLVED_PREFIX - and
    // therefore the OpenAPI spec - never sees. `?`, `#` and whitespace only
    // produce routes that can never match.
    if (/[?#\s*:]/.test(value)) {
      throw new TypeError(`Invalid global prefix: ${JSON.stringify(value)}`)
    }
    this.prefix = joinPaths(value)
  }

  /** Guard classes registered via `app.useGuard()`, captured at compile time. */
  get globalGuards(): readonly unknown[] {
    return this.globalGuardClasses
  }

  /**
   * Adapter-level body cap: max(default, all per-route limits); `false` when
   * the app default is disabled. Read by Miia.listen() after init.
   */
  get adapterBodyCeiling(): number | false {
    return this.defaultBodyLimit === false ? false : Math.max(this.defaultBodyLimit, this.maxRouteBodyLimit)
  }

  add(
    method: HttpMethod,
    pattern: string,
    handler: (ctx: RequestContext) => unknown,
    options: AddRouteOptions = {},
  ): void {
    const { middlewares = [], skipGlobalGuards = false, skippedGuardClasses = null } = options
    const bodyLimit = options.bodyLimit ?? this.defaultBodyLimit
    if (typeof bodyLimit === 'number' && bodyLimit > this.maxRouteBodyLimit) {
      this.maxRouteBodyLimit = bodyLimit
    }
    const normalized =
      this.prefix === '' || options.skipGlobalPrefix ? normalizePath(pattern) : joinPaths(this.prefix, pattern)
    const segments = normalized === '' ? [] : normalized.split('/')
    const entry: RouteEntry = {
      method,
      pattern: normalized,
      handler,
      middlewares,
      skipGlobalGuards,
      skippedGuardClasses,
      bodyLimit,
    }

    this.allEntries.push(entry)

    const isStatic = !segments.some((s) => s.startsWith(':') || s === '*')
    if (isStatic) {
      this.staticRoutes.set(method + ':' + normalized, entry)
    }

    let root = this.tries.get(method)
    if (!root) {
      root = createNode()
      this.tries.set(method, root)
    }

    let node = root
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]

      if (seg === '*') {
        node.wildcard = { name: '*', entry }
        return
      }

      if (seg.startsWith(':')) {
        if (!node.param) node.param = { name: seg.slice(1), node: createNode() }
        node = node.param.node
      } else {
        let child = node.children.get(seg)
        if (!child) {
          child = createNode()
          node.children.set(seg, child)
        }
        node = child
      }
    }

    node.entry = entry
  }

  match(method: string, pathname: string): MatchResult | null {
    // Inline normalization - pathname always starts with '/' from fastUrlParse
    const normalized =
      pathname.length === 1
        ? ''
        : pathname.charCodeAt(pathname.length - 1) === 47 /* '/' */
          ? pathname.substring(1, pathname.length - 1)
          : pathname.substring(1)

    // Fast O(1) static lookup
    const staticEntry = this.staticRoutes.get(method + ':' + normalized)
    if (staticEntry) {
      return {
        handler: staticEntry.handler,
        params: {},
        bodyLimit: staticEntry.bodyLimit,
        compiledPipeline: staticEntry.compiledPipeline,
      }
    }

    // HEAD static fallback
    if (method === 'HEAD') {
      const headEntry = this.staticRoutes.get('GET:' + normalized)
      if (headEntry) {
        return {
          handler: headEntry.handler,
          params: {},
          bodyLimit: headEntry.bodyLimit,
          compiledPipeline: headEntry.compiledPipeline,
        }
      }
    }

    // Trie lookup for dynamic routes
    const pathSegments = normalized === '' ? [] : normalized.split('/')

    const result = this.matchTrie(method, pathSegments)
    if (result) return result

    if (method === 'HEAD') {
      return this.matchTrie('GET', pathSegments)
    }

    return null
  }

  compileAll(globalGuards: GlobalGuardBinding[]): void {
    this.globalGuardClasses = globalGuards.map((g) => g.guardClass)

    for (const route of this.allEntries) {
      const effectiveGuards = route.skipGlobalGuards
        ? []
        : globalGuards.length === 0
          ? []
          : route.skippedGuardClasses
            ? globalGuards.filter((g) => !isSkipped(g.guardClass, route.skippedGuardClasses!)).map((g) => g.middleware)
            : globalGuards.map((g) => g.middleware)

      const allMws =
        effectiveGuards.length === 0
          ? route.middlewares
          : route.middlewares.length === 0
            ? effectiveGuards
            : [...effectiveGuards, ...route.middlewares]

      route.compiledPipeline = allMws.length > 0 ? compose(allMws) : undefined
    }
  }

  private matchTrie(method: string, pathSegments: string[]): MatchResult | null {
    const root = this.tries.get(method)
    if (!root) return null

    const params: Record<string, string> = {}
    let node = root

    for (let i = 0; i < pathSegments.length; i++) {
      const seg = pathSegments[i]

      const exactChild = node.children.get(seg)
      if (exactChild) {
        node = exactChild
        continue
      }

      if (node.param) {
        params[node.param.name] = seg
        node = node.param.node
        continue
      }

      if (node.wildcard) {
        params[node.wildcard.name] = pathSegments.slice(i).join('/')
        const e = node.wildcard.entry
        return { handler: e.handler, params, bodyLimit: e.bodyLimit, compiledPipeline: e.compiledPipeline }
      }

      return null
    }

    if (node.entry) {
      return {
        handler: node.entry.handler,
        params,
        bodyLimit: node.entry.bodyLimit,
        compiledPipeline: node.entry.compiledPipeline,
      }
    }

    if (node.wildcard) {
      params[node.wildcard.name] = ''
      const e = node.wildcard.entry
      return { handler: e.handler, params, bodyLimit: e.bodyLimit, compiledPipeline: e.compiledPipeline }
    }

    return null
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}

function isSkipped(guardClass: unknown, skipSet: Set<unknown>): boolean {
  if (skipSet.has(guardClass)) return true
  const factory = (guardClass as any)?.[GUARD_FACTORY]
  return factory != null && skipSet.has(factory)
}
