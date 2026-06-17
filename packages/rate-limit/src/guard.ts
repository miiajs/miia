import type { CanActivate, Guard, RequestContext } from '@miiajs/core'
import { GUARD_FACTORY, injectOptional, TooManyRequestsException } from '@miiajs/core'
import { RATE_LIMIT_OPTIONS } from './constants.js'
import { setRateLimitHeaders } from './headers.js'
import { RateLimiter } from './rate-limiter.js'
import type { HeadersMode, KeyGenerator, RateLimitPolicy, RateLimitStore } from './types.js'

export interface RateLimitModuleOptions extends RateLimitPolicy {
  store?: RateLimitStore
  keyGenerator?: KeyGenerator
  headers?: HeadersMode
  message?: string
  /** Explicit prefix = deliberate bucket sharing between guard instances. */
  prefix?: string
}

const defaultKeyGenerator: KeyGenerator = (ctx) => ctx.ip ?? 'unknown'

// Per-instance namespace counter for guards. Distinct from the middleware's
// `rlmw:` so the two counters cannot collide on a shared module store.
let prefixSeq = 0

function mergeOptions(
  moduleOptions: RateLimitModuleOptions | null,
  overrides?: Partial<RateLimitModuleOptions>,
): RateLimitModuleOptions {
  const merged = { ...(moduleOptions ?? {}), ...(overrides ?? {}) } as RateLimitModuleOptions
  if (merged.limit === undefined || merged.window === undefined) {
    throw new Error(
      '[RateLimit] RateLimitGuard used without configuration. Register RateLimitModule.configure({ limit, window }) or use RateLimitGuard({ limit, window }).',
    )
  }
  return merged
}

/**
 * GUARD_FACTORY marker for class-scoped decorator guards. Internal sentinel,
 * not a real guard - used so `@SkipGuard(RATE_LIMIT_CLASS_SCOPE)` can target
 * a controller-level `@RateLimit` without touching the global guard.
 * @internal intra-package use only; not re-exported from the package index.
 */
export function RATE_LIMIT_CLASS_SCOPE(): void {}

/**
 * GUARD_FACTORY marker for method-scoped decorator guards. Internal sentinel,
 * not a real guard - used so a method-level `@RateLimit` is the only guard the
 * route's skip set does not filter out.
 * @internal intra-package use only; not re-exported from the package index.
 */
export function RATE_LIMIT_METHOD_SCOPE(): void {}

/**
 * Builds a scoped rate-limit guard class. The `marker` is stamped onto the
 * class via `GUARD_FACTORY` so core's skip-set unwrap can match it; defaulting
 * to `RateLimitGuard` keeps bare/factory behavior unchanged.
 * @internal intra-package use only; not re-exported from the package index.
 */
export function buildGuardClass(overrides?: Partial<RateLimitModuleOptions>, marker: Function = RateLimitGuard): Guard {
  class ScopedRateLimitGuard implements CanActivate {
    // Resolve module options eagerly during construction (inside an active
    // container context); merging fails fast if neither layer configured the policy.
    private cfg = mergeOptions(injectOptional<RateLimitModuleOptions>(RATE_LIMIT_OPTIONS), overrides)
    private limiter = new RateLimiter({ ...this.cfg, prefix: this.cfg.prefix ?? `rlg:${prefixSeq++}:` })

    async canActivate(ctx: RequestContext): Promise<boolean> {
      const key = await (this.cfg.keyGenerator ?? defaultKeyGenerator)(ctx)
      const result = await this.limiter.limit(key)
      setRateLimitHeaders(ctx.res, result, this.cfg.headers ?? 'draft-6', this.limiter.windowMs)
      if (!result.success) {
        // Throw, do NOT return false: a false return maps to ForbiddenException (403).
        const retryAfter = Math.max(1, Math.ceil((result.retryAfterMs ?? result.resetMs) / 1000))
        throw new TooManyRequestsException(this.cfg.message ?? 'Too Many Requests', { retryAfter })
      }
      return true
    }
  }

  ;(ScopedRateLimitGuard as any)[GUARD_FACTORY] = marker
  return ScopedRateLimitGuard
}

/**
 * Dual class/factory guard.
 *
 * - As a bare guard class: `app.useGuard(RateLimitGuard)` (requires `RateLimitModule.configure`).
 * - As a factory: `@UseGuard(RateLimitGuard({ limit, window }))`.
 *
 * A TS class cannot be invoked without `new`, so this is a constructible
 * function that dispatches on `new.target` (constructor returning an object is
 * legal JS).
 */
export const RateLimitGuard: Guard & ((policy: RateLimitPolicy & Partial<RateLimitModuleOptions>) => Guard) = function (
  this: unknown,
  policy?: RateLimitPolicy & Partial<RateLimitModuleOptions>,
): unknown {
  if (new.target) {
    // bare: app.useGuard(RateLimitGuard)
    return new (buildGuardClass())()
  }
  // factory: @UseGuard(RateLimitGuard(policy))
  return buildGuardClass(policy)
} as any
