import { HttpException, UnprocessableException } from './exceptions.js'
import type { BodyReader, Middleware, RequestContext, RouteOptions } from './types.js'

/** The reader a body schema uses when no package registered one for the handler. */
export const jsonBodyReader: BodyReader = {
  contentType: 'application/json',
  // Malformed JSON is already a 400 HttpException and passes through, as do the
  // adapters' body-limit errors (name 'PayloadTooLargeError') so an oversized
  // body stays a 413. Only an unexpected read failure becomes null (-> 422).
  read: (ctx) =>
    ctx.json().catch((e: unknown) => {
      if (e instanceof HttpException || (e instanceof Error && e.name === 'PayloadTooLargeError')) throw e
      return null
    }),
  commit: (ctx, data) => ctx._setBody(data),
}

/** undefined when the route declares no schema, so it keeps its middleware-free fast path. */
export function createValidationMiddleware(schemas: RouteOptions, reader: BodyReader): Middleware | undefined {
  const { params, query, body } = schemas
  if (!params && !query && !body) return undefined

  const checkUrl = (ctx: RequestContext): void => {
    if (params) {
      const result = params.safeParse(ctx.params)
      if (!result.success) throw new UnprocessableException('Params validation failed', result.error.issues)
      ctx.params = result.data
    }
    if (query) {
      const result = query.safeParse(ctx.query)
      if (!result.success) throw new UnprocessableException('Query validation failed', result.error.issues)
      ctx.query = result.data
    }
  }

  if (!body) {
    return (ctx, next) => {
      checkUrl(ctx)
      return next()
    }
  }

  return async (ctx, next) => {
    checkUrl(ctx)
    const result = body.safeParse(await reader.read(ctx))
    if (!result.success) throw new UnprocessableException('Body validation failed', result.error.issues)
    reader.commit(ctx, result.data)
    await next()
  }
}
