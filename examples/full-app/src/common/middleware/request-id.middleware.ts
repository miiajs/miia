import type { Middleware } from '@miiajs/core'

/**
 * Assigns a stable request id to every request and exposes it via the
 * `X-Request-Id` response header. Honors an incoming `X-Request-Id` so
 * upstream tracing ids propagate through; generates a fresh UUID otherwise.
 *
 * The id is attached to `ctx.requestId` for downstream middleware and
 * handlers (see `requestLogger` which prefixes log lines with it).
 */
export function requestId(): Middleware {
  return async (ctx, next) => {
    const id = ctx.req.headers.get('x-request-id') ?? crypto.randomUUID()
    ctx.requestId = id
    ctx.res.header('X-Request-Id', id)
    await next()
  }
}
