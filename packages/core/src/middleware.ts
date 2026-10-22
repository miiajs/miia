import type { CanActivate, Middleware, RequestContext } from './types.js'
import { ForbiddenException } from './exceptions.js'

/** A composed middleware chain: always a promise, a synchronous throw included. */
export type Pipeline = (ctx: RequestContext, next: () => Promise<void>) => Promise<void>

// ─── Compose (Koa-style onion model) ────────────────────────────

// koa-compose without async functions: no extra promise and tick per level.
export function compose(middlewares: Middleware[]): Pipeline {
  return (ctx: RequestContext, next: () => Promise<void>) => {
    let index = -1

    function dispatch(i: number): Promise<void> {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'))
      index = i
      try {
        return Promise.resolve(i < middlewares.length ? middlewares[i](ctx, () => dispatch(i + 1)) : next())
      } catch (error) {
        return Promise.reject(error)
      }
    }

    return dispatch(0)
  }
}

// ─── Guard → Middleware conversion (internal) ────────────────────

export function guardToMiddleware(guard: CanActivate): Middleware {
  return (ctx: RequestContext, next: () => Promise<void>) => {
    const result = guard.canActivate(ctx)
    if (result instanceof Promise) {
      return result.then((allowed) => {
        if (!allowed) throw new ForbiddenException()
        return next()
      })
    }
    if (!result) throw new ForbiddenException()
    return next()
  }
}
