import { GUARD_FACTORY } from './decorators/metadata.js'
import { compose } from './middleware.js'
import type { HttpMethod, Middleware, RequestContext } from './types.js'

interface RouteEntry {
  method: HttpMethod
  pattern: string
  handler: (ctx: RequestContext) => unknown
  middlewares: Middleware[]
  skipGlobalGuards: boolean
  skippedGuardClasses: Set<unknown> | null
  compiledPipeline?: Middleware
}

export interface MatchResult {
  handler: (ctx: RequestContext) => unknown
  params: Record<string, string>
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

  add(
    method: HttpMethod,
    pattern: string,
    handler: (ctx: RequestContext) => unknown,
    options: AddRouteOptions = {},
  ): void {
    const { middlewares = [], skipGlobalGuards = false, skippedGuardClasses = null } = options
    const normalized = normalizePath(pattern)
    const segments = normalized === '' ? [] : normalized.split('/')
    const entry: RouteEntry = {
      method,
      pattern: normalized,
      handler,
      middlewares,
      skipGlobalGuards,
      skippedGuardClasses,
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
        return { handler: e.handler, params, compiledPipeline: e.compiledPipeline }
      }

      return null
    }

    if (node.entry) {
      return {
        handler: node.entry.handler,
        params,

        compiledPipeline: node.entry.compiledPipeline,
      }
    }

    if (node.wildcard) {
      params[node.wildcard.name] = ''
      const e = node.wildcard.entry
      return { handler: e.handler, params, compiledPipeline: e.compiledPipeline }
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
