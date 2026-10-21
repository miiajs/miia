import { DEFAULT_BODY_LIMIT } from './body-limit.js'
import { GUARD_FACTORY } from './decorators/metadata.js'
import { Logger } from './logger.js'
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
  /** `:param` names of this route; each is read from the path segment at the same index in `paramIndexes`. */
  paramNames: string[]
  paramIndexes: number[]
  /** Segment index of a trailing `*`, or -1. */
  wildcardIndex: number
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

// Param nodes carry no name: routes that share one (`/u/:id`, `/u/:userId/posts`)
// each keep their own names on the entry.
interface TrieNode {
  children: Map<string, TrieNode>
  param: TrieNode | null
  wildcard: RouteEntry | null
  entry: RouteEntry | null
}

function createNode(): TrieNode {
  return { children: new Map(), param: null, wildcard: null, entry: null }
}

// Depth-first in priority order. A node sits at one depth only, so a lookup visits each node
// of the method's tree at most once: linear in the size of the route table, never exponential.
function search(node: TrieNode, segments: string[], i: number): RouteEntry | null {
  if (i === segments.length) return node.entry ?? node.wildcard

  const child = node.children.get(segments[i])
  if (child !== undefined) {
    const found = search(child, segments, i + 1)
    if (found !== null) return found
  }
  if (node.param !== null) {
    const found = search(node.param, segments, i + 1)
    if (found !== null) return found
  }
  return node.wildcard
}

function routeParams(entry: RouteEntry, segments: string[]): Record<string, string> {
  const params: Record<string, string> = {}
  const names = entry.paramNames
  for (let i = 0; i < names.length; i++) {
    params[names[i]] = segments[entry.paramIndexes[i]]
  }
  if (entry.wildcardIndex !== -1) {
    params['*'] = segments.slice(entry.wildcardIndex).join('/')
  }
  return params
}

// ─── Router ─────────────────────────────────────────────────────

export class Router {
  private logger = new Logger(Router.name)
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
        '[Miia] The global prefix must be set before any route is registered - controller routes are ' +
          'resolved with the module graph (first init(), app.get() or fetch()), addRoute() routes on the call. ' +
          'Use new Miia({ globalPrefix }) instead.',
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
    const normalized =
      this.prefix === '' || options.skipGlobalPrefix ? normalizePath(pattern) : joinPaths(this.prefix, pattern)
    const segments = normalized === '' ? [] : normalized.split('/')
    const isStatic = !segments.some((s) => s.startsWith(':') || s === '*')

    // Checked before anything is written, so a rejected route leaves no entry,
    // no raised body ceiling and no empty trie nodes behind.
    const existing = this.findExisting(method, normalized, segments, isStatic)
    if (existing) {
      throw new Error(`[Miia] Route ${method} /${normalized} conflicts with ${existing.method} /${existing.pattern}`)
    }

    const bodyLimit = options.bodyLimit ?? this.defaultBodyLimit
    if (typeof bodyLimit === 'number' && bodyLimit > this.maxRouteBodyLimit) {
      this.maxRouteBodyLimit = bodyLimit
    }

    const paramNames: string[] = []
    const paramIndexes: number[] = []
    let wildcardIndex = -1
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] === '*') {
        wildcardIndex = i
        break
      }
      if (segments[i].startsWith(':')) {
        paramNames.push(segments[i].slice(1))
        paramIndexes.push(i)
      }
    }

    const entry: RouteEntry = {
      method,
      pattern: normalized,
      handler,
      middlewares,
      skipGlobalGuards,
      skippedGuardClasses,
      bodyLimit,
      paramNames,
      paramIndexes,
      wildcardIndex,
    }

    this.allEntries.push(entry)
    this.logger.log(`Mapped {/${normalized}, ${method}} route`)

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
        node.wildcard = entry
        return
      }

      if (seg.startsWith(':')) {
        if (!node.param) node.param = createNode()
        node = node.param
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

  /**
   * At every segment a static child beats the param child, which beats a wildcard. The walk
   * follows the best branch only, so a hit costs one pass; when it dead-ends after passing
   * over a lower-priority branch, `search()` backs up to the first such node and tries the rest.
   * The walk stays inline on purpose: moved into a helper, it measured slower on every lookup,
   * static hits included (a small `matchTrie()` gets inlined into `match()`).
   */
  private matchTrie(method: string, pathSegments: string[]): MatchResult | null {
    const root = this.tries.get(method)
    if (!root) return null

    let node = root
    let from: TrieNode | null = null
    let fromIndex = 0
    let i = 0
    for (; i < pathSegments.length; i++) {
      const child = node.children.get(pathSegments[i])
      if (child !== undefined) {
        if (from === null && (node.param !== null || node.wildcard !== null)) {
          from = node
          fromIndex = i
        }
        node = child
      } else if (node.param !== null) {
        if (from === null && node.wildcard !== null) {
          from = node
          fromIndex = i
        }
        node = node.param
      } else {
        break
      }
    }

    let entry = i === pathSegments.length ? (node.entry ?? node.wildcard) : node.wildcard
    if (entry === null && from !== null) entry = search(from, pathSegments, fromIndex)
    if (entry === null) return null

    return {
      handler: entry.handler,
      params: routeParams(entry, pathSegments),
      bodyLimit: entry.bodyLimit,
      compiledPipeline: entry.compiledPipeline,
    }
  }

  /**
   * The route already sitting where this one would go: same method, same trie
   * position. Param names do not count - `:id` and `:userId` share one param node.
   */
  private findExisting(
    method: HttpMethod,
    normalized: string,
    segments: string[],
    isStatic: boolean,
  ): RouteEntry | null {
    if (isStatic) return this.staticRoutes.get(method + ':' + normalized) ?? null

    let node: TrieNode | null | undefined = this.tries.get(method)
    for (const seg of segments) {
      if (!node) return null
      if (seg === '*') return node.wildcard
      node = seg.startsWith(':') ? node.param : node.children.get(seg)
    }
    return node?.entry ?? null
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
