import type { Middleware } from '@miiajs/core'

export const __name__Middleware: Middleware = async (_ctx, next) => {
  await next()
}
