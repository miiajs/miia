import type { Middleware, RequestContext } from '@miiajs/core'
import { TooManyRequestsException } from '@miiajs/core'
import { setRateLimitHeaders } from './headers.js'
import { RateLimiter } from './rate-limiter.js'
import type { HeadersMode, KeyGenerator, RateLimitPolicy, RateLimitStore } from './types.js'

export interface RateLimitOptions extends RateLimitPolicy {
  store?: RateLimitStore
  /** @default (ctx) => ctx.ip ?? 'unknown' */
  keyGenerator?: KeyGenerator
  /** @default 'draft-6' */
  headers?: HeadersMode
  /** Skip rate limiting for a request when this returns true. */
  skip?: (ctx: RequestContext) => boolean | Promise<boolean>
  /** @default 'Too Many Requests' */
  message?: string
  /** Key namespace prefix. Defaults to a unique `rlmw:N:` namespace. */
  prefix?: string
}

const defaultKeyGenerator: KeyGenerator = (ctx) => ctx.ip ?? 'unknown'

// Per-instance namespace counter. Two middleware instances on a shared store do
// not collide; an explicit `prefix` is opt-in sharing. The `rlmw:` namespace is
// distinct from the guard's `rlg:` so the two counters (separate files, both
// starting at 0) cannot collide on a shared store.
let mwSeq = 0

/**
 * Self-contained rate-limit middleware. Owns its own `RateLimiter`, created once.
 */
export function rateLimit(options: RateLimitOptions): Middleware {
  const limiter = new RateLimiter({
    ...options,
    prefix: options.prefix ?? `rlmw:${mwSeq++}:`,
  })
  const keyGenerator = options.keyGenerator ?? defaultKeyGenerator
  const headers = options.headers ?? 'draft-6'
  const message = options.message ?? 'Too Many Requests'
  const skip = options.skip

  return async (ctx, next) => {
    if (skip && (await skip(ctx))) {
      return next()
    }

    const key = await keyGenerator(ctx)
    const result = await limiter.limit(key)
    setRateLimitHeaders(ctx.res, result, headers, limiter.windowMs)

    if (!result.success) {
      const retryAfter = Math.max(1, Math.ceil((result.retryAfterMs ?? result.resetMs) / 1000))
      throw new TooManyRequestsException(message, { retryAfter })
    }

    return next()
  }
}
