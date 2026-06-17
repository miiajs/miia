import type { ResponseBuilder } from '@miiajs/core'
import type { HeadersMode, RateLimitResult } from './types.js'

/**
 * Write rate-limit headers onto the response.
 *
 * Headers MUST go through `res.header()` so that `_modified = true` is set -
 * otherwise the JSON fast path silently drops `RateLimit-*` on success responses.
 * Never touch the internal headers map directly.
 *
 * `Retry-After` is always emitted on `!success`, even when `mode === false`.
 */
export function setRateLimitHeaders(
  res: ResponseBuilder,
  result: RateLimitResult,
  mode: HeadersMode,
  windowMs: number,
): void {
  if (mode === 'draft-6') {
    res.header('RateLimit-Limit', String(result.limit))
    res.header('RateLimit-Remaining', String(result.remaining))
    res.header('RateLimit-Reset', String(resetSeconds(result.resetMs)))
    res.header('RateLimit-Policy', `${result.limit};w=${Math.ceil(windowMs / 1000)}`)
  } else if (mode === 'legacy') {
    res.header('X-RateLimit-Limit', String(result.limit))
    res.header('X-RateLimit-Remaining', String(result.remaining))
    res.header('X-RateLimit-Reset', String(resetSeconds(result.resetMs)))
  }

  if (!result.success) {
    const retryMs = result.retryAfterMs ?? result.resetMs
    res.header('Retry-After', String(Math.max(1, Math.ceil(retryMs / 1000))))
  }
}

// Delta seconds, clamped to >= 0 (draft-6 requires a non-negative value).
function resetSeconds(resetMs: number): number {
  return Math.max(0, Math.ceil(resetMs / 1000))
}
