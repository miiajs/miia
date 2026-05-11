import type { Middleware, RequestContext } from './types.js'
import { ForbiddenException } from './exceptions.js'

// ─── Compose (Koa-style onion model) ────────────────────────────

export function compose(middlewares: Middleware[]): Middleware {
  return async (ctx: RequestContext, next: () => Promise<void>) => {
    let index = -1

    async function dispatch(i: number): Promise<void> {
      if (i <= index) throw new Error('next() called multiple times')
      index = i

      if (i < middlewares.length) {
        await middlewares[i](ctx, () => dispatch(i + 1))
      } else {
        await next()
      }
    }

    await dispatch(0)
  }
}

// ─── Guard → Middleware conversion (internal) ────────────────────

export function guardToMiddleware(fn: (ctx: RequestContext) => boolean | Promise<boolean>): Middleware {
  return (ctx: RequestContext, next: () => Promise<void>) => {
    const result = fn(ctx)
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
