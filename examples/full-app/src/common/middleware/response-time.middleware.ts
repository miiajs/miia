import type { Middleware } from '@miiajs/core'

/**
 * Measures how long a request takes to process and writes the duration
 * to the `X-Response-Time` response header.
 *
 * Demonstrates the Koa onion model: work can happen both before and
 * after `await next()`, because `ctx.res` is built into a `Response`
 * only once the full middleware chain unwinds. The `try/finally`
 * guarantees the header is set even when a downstream middleware or
 * handler throws - core's `handleError` merges `ctx.res` headers into
 * the error response.
 */
export function responseTime(): Middleware {
  return async (ctx, next) => {
    const start = performance.now()
    try {
      await next()
    } finally {
      const ms = (performance.now() - start).toFixed(1)
      ctx.res.header('X-Response-Time', `${ms}ms`)
    }
  }
}
