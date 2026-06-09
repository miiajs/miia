import type { Guard, Middleware, ZodLike } from '../types.js'
import {
  CLASS_MW,
  METHOD_MW,
  CLASS_GUARDS,
  METHOD_GUARDS,
  STATUSES,
  SKIP_GUARDS,
  BODY_LIMITS,
  BODY_SCHEMAS,
  QUERY_SCHEMAS,
  PARAMS_SCHEMAS,
  addToMapMeta,
  setMeta,
  setInMapMeta,
} from './metadata.js'
import { HttpException, UnprocessableException } from '../exceptions.js'
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
 * Chunked bodies (no Content-Length) are capped by the adapter-level ceiling
 * (max of all limits), not the per-route value - the body is read independently
 * of route matching.
 */
export const BodyLimit = createDecorator<[bytes: number]>((context, bytes) => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    throw new TypeError(`@BodyLimit expects a non-negative finite number of bytes, got ${String(bytes)}`)
  }
  const name = context.kind === 'class' ? '*' : String(context.name)
  setInMapMeta(context.metadata!, BODY_LIMITS, name, bytes)
})

// ─── @ValidateBody ───────────────────────────────────────────────

export const ValidateBody = createMethodDecorator<[schema: ZodLike]>((_target, context, schema) => {
  const mw: Middleware = async (ctx, next) => {
    // Swallow malformed-body rejections into null (-> 422 via safeParse), but
    // rethrow HttpExceptions and the adapters' body-limit errors (name
    // 'PayloadTooLargeError') so an oversized body stays a 413, not a 422.
    const body = await ctx.json().catch((e: unknown) => {
      if (e instanceof HttpException || (e instanceof Error && e.name === 'PayloadTooLargeError')) throw e
      return null
    })
    const result = schema.safeParse(body)
    if (!result.success) {
      throw new UnprocessableException('Body validation failed', result.error.issues)
    }
    ctx._setBody(result.data)
    await next()
  }
  setInMapMeta(context.metadata!, BODY_SCHEMAS, String(context.name), schema)
  addToMapMeta(context.metadata!, METHOD_MW, String(context.name), [mw])
})

// ─── @ValidateQuery ──────────────────────────────────────────────

export const ValidateQuery = createMethodDecorator<[schema: ZodLike]>((_target, context, schema) => {
  const mw: Middleware = async (ctx, next) => {
    const result = schema.safeParse(ctx.query)
    if (!result.success) {
      throw new UnprocessableException('Query validation failed', result.error.issues)
    }
    ctx.query = result.data
    await next()
  }
  setInMapMeta(context.metadata!, QUERY_SCHEMAS, String(context.name), schema)
  addToMapMeta(context.metadata!, METHOD_MW, String(context.name), [mw])
})

// ─── @ValidateParams ─────────────────────────────────────────────

export const ValidateParams = createMethodDecorator<[schema: ZodLike]>((_target, context, schema) => {
  const mw: Middleware = async (ctx, next) => {
    const result = schema.safeParse(ctx.params)
    if (!result.success) {
      throw new UnprocessableException('Params validation failed', result.error.issues)
    }
    ctx.params = result.data
    await next()
  }
  setInMapMeta(context.metadata!, PARAMS_SCHEMAS, String(context.name), schema)
  addToMapMeta(context.metadata!, METHOD_MW, String(context.name), [mw])
})

// ─── @Status ─────────────────────────────────────────────────────

export const Status = createMethodDecorator<[code: number]>((_target, context, code) => {
  setInMapMeta(context.metadata!, STATUSES, String(context.name), code)
})
