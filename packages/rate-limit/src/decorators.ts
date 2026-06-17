import { createDecorator, SkipGuard, UseGuard } from '@miiajs/core'
import { buildGuardClass, RATE_LIMIT_CLASS_SCOPE, RATE_LIMIT_METHOD_SCOPE, RateLimitGuard } from './guard.js'
import type { RateLimitModuleOptions } from './guard.js'
import type { RateLimitPolicy } from './types.js'

/**
 * Apply rate limiting to a controller or route with an explicit policy.
 *
 * Replaces (does not stack with) any less-specific limiter on the route, by the
 * `@BodyLimit` precedent (method > class > global):
 * - on a method, the method's own limiter is the only one that runs - the class
 *   `@RateLimit` and the global guard are filtered out for that route;
 * - on a class, the limiter replaces the global guard for every route of the
 *   controller.
 *
 * Stacking stays available explicitly via the middleware form (`app.use` /
 * `@Use(rateLimit(...))`).
 */
export const RateLimit = createDecorator<[policy: RateLimitPolicy & Partial<RateLimitModuleOptions>]>(
  (context, policy) => {
    // The createDecorator handler receives no `target`; UseGuard/SkipGuard
    // products are `(target, context)` functions whose handlers read only
    // `context`, so passing `undefined` as target is safe.
    if (context.kind === 'class') {
      // Disable the global guard on every route of the controller, install the
      // class-scoped limiter (marker survives the class skip set).
      SkipGuard(RateLimitGuard)(undefined, context)
      UseGuard(buildGuardClass(policy, RATE_LIMIT_CLASS_SCOPE))(undefined, context)
    } else {
      // Disable the global guard AND any class-scoped `@RateLimit` for this
      // route, install the method-scoped limiter (its marker is not skipped).
      SkipGuard(RateLimitGuard, RATE_LIMIT_CLASS_SCOPE)(undefined, context)
      UseGuard(buildGuardClass(policy, RATE_LIMIT_METHOD_SCOPE))(undefined, context)
    }
  },
)

/**
 * Exclude a route (or controller) from rate limiting entirely - covers the
 * global guard, factory guards, and both decorator scopes. Skip wins over
 * `@RateLimit` on the same target.
 */
export function SkipRateLimit() {
  return SkipGuard(RateLimitGuard, RATE_LIMIT_CLASS_SCOPE, RATE_LIMIT_METHOD_SCOPE)
}
