import type { Guard, Middleware, ZodLike } from '../types.js'
import {
  CLASS_MW,
  METHOD_MW,
  CLASS_GUARDS,
  METHOD_GUARDS,
  STATUSES,
  SKIP_GUARDS,
  BODY_SCHEMAS,
  QUERY_SCHEMAS,
  PARAMS_SCHEMAS,
  addToMapMeta,
  setMeta,
  setInMapMeta,
} from './metadata.js'
import { UnprocessableException } from '../exceptions.js'
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

// ─── @ValidateBody ───────────────────────────────────────────────

export const ValidateBody = createMethodDecorator<[schema: ZodLike]>((_target, context, schema) => {
  const mw: Middleware = async (ctx, next) => {
    // .catch(() => null) intentionally swallows both fresh req.json() rejections
    // (malformed body) and cached rejections from prior ctx.json() calls in other
    // middleware - null then flows through safeParse and becomes an UnprocessableException.
    const body = await ctx.json().catch(() => null)
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
