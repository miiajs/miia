import type { Guard, Middleware } from '../types.js'
import {
  CLASS_MW,
  METHOD_MW,
  CLASS_GUARDS,
  METHOD_GUARDS,
  STATUSES,
  SKIP_GUARDS,
  BODY_LIMITS,
  addToMapMeta,
  setMeta,
  setInMapMeta,
} from './metadata.js'
import { createMethodDecorator } from './create-decorator.js'
import { createDecorator } from './create-decorator.js'

// ─── @Use ────────────────────────────────────────────────────────

export const Use = createDecorator<[...middlewares: Middleware[]]>((context, ...middlewares) => {
  if (context.kind === 'class') {
    const existing = (context.metadata![CLASS_MW] as Middleware[]) ?? []
    setMeta(context.metadata!, CLASS_MW, [...existing, ...middlewares])
  } else {
    addToMapMeta(context.metadata!, METHOD_MW, String(context.name), middlewares)
  }
})

// ─── @UseGuard ───────────────────────────────────────────────────

export const UseGuard = createDecorator<[...guards: Guard[]]>((context, ...guards) => {
  if (context.kind === 'class') {
    const existing = (context.metadata![CLASS_GUARDS] as Guard[]) ?? []
    setMeta(context.metadata!, CLASS_GUARDS, [...existing, ...guards])
  } else {
    addToMapMeta(context.metadata!, METHOD_GUARDS, String(context.name), guards)
  }
})

// ─── @SkipGuard ─────────────────────────────────────────────────

export const SkipGuard = createDecorator<[first: Guard | Function, ...rest: (Guard | Function)[]]>(
  (context, ...guards) => {
    const name = context.kind === 'class' ? '*' : String(context.name)
    const map: Map<string, Set<any>> = (context.metadata![SKIP_GUARDS] as Map<string, Set<any>>) ?? new Map()
    const existing = map.get(name) ?? new Set()
    for (const g of guards) existing.add(g)
    map.set(name, existing)
    context.metadata![SKIP_GUARDS] = map
  },
)

// ─── @BodyLimit ──────────────────────────────────────────────────

/**
 * Sets the max request body size in bytes for a route (method) or all routes
 * of a controller (class). Method-level overrides class-level, which overrides
 * the app-wide `maxBodySize` option. A declared Content-Length above the limit
 * yields a 413 PayloadTooLargeException before the handler runs.
 *
 * A chunked body (no Content-Length) has nothing to check up front, so the
 * limit is handed to the adapter after routing and counted as the bytes
 * arrive. `@miiajs/node-server` honours it; a runtime whose request is a real
 * `Request` - Bun, Deno, `app.fetch` - keeps the adapter ceiling instead.
 */
export const BodyLimit = createDecorator<[bytes: number]>((context, bytes) => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    throw new TypeError(`@BodyLimit expects a non-negative finite number of bytes, got ${String(bytes)}`)
  }
  const name = context.kind === 'class' ? '*' : String(context.name)
  setInMapMeta(context.metadata!, BODY_LIMITS, name, bytes)
})

// ─── @Status ─────────────────────────────────────────────────────

export const Status = createMethodDecorator<[code: number]>((_target, context, code) => {
  setInMapMeta(context.metadata!, STATUSES, String(context.name), code)
})
