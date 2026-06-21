import { HttpException, Logger, type Middleware } from '@miiajs/core'

/**
 * Logs each incoming HTTP request with method, path, status code and
 * duration. Errors are logged with the status derived from `HttpException`
 * (or `500` for unhandled errors), then rethrown so core's error handler
 * can produce the actual response.
 */
export function requestLogger(): Middleware {
  const logger = new Logger('HTTP')

  return async (ctx, next) => {
    const start = performance.now()
    const { method } = ctx.req
    const { pathname } = new URL(ctx.req.url)

    let status = 0
    try {
      await next()
      status = ctx.res.getStatus()
    } catch (err) {
      status = err instanceof HttpException ? err.statusCode : 500
      throw err
    } finally {
      const ms = (performance.now() - start).toFixed(1)
      const prefix = ctx.requestId ? `[${ctx.requestId.slice(0, 8)}] ` : ''
      const ip = ctx.ip ?? '-'
      const line = `${prefix}${ip} ${method} ${pathname} ${status} - ${ms}ms`
      if (status >= 500) logger.error(line)
      else if (status >= 400) logger.warn(line)
      else logger.log(line)
    }
  }
}
