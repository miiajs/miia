import type { RequestContext } from '@miiajs/core'

export interface RateLimitPolicy {
  limit: number
  /** Window length in ms, or a duration string: `'500ms' | '10s' | '5m' | '1h' | '1d'`. */
  window: number | string
  /** Optional ban after the limit is exceeded. Same units as `window`. */
  blockDuration?: number | string
  /**
   * Geometric block backoff multiplier applied per repeat offence: the ban grows
   * `blockDuration`, `blockDuration × blockBackoff`, `blockDuration × blockBackoff²`, ...
   * Default `1` (no escalation). Values `> 1` opt into strike memory and require `maxBlockDuration`.
   */
  blockBackoff?: number
  /** Ceiling for the escalated ban. Same units as `window`. Required when `blockBackoff > 1`. */
  maxBlockDuration?: number | string
  /**
   * Grace period of clean behaviour before accumulated strikes reset to zero,
   * measured from the end of the block. Same units as `window`. Default = `maxBlockDuration`.
   */
  strikeReset?: number | string
}

export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  /** Milliseconds until the window resets (delta, not an epoch timestamp). */
  resetMs: number
  /** Milliseconds the client should wait before retrying. Set when `success === false`. */
  retryAfterMs?: number
}

/**
 * Resolved options passed to {@link RateLimitStore.increment}. All fields are
 * numbers - the `RateLimiter` does the parsing and default resolution so the
 * store stays "dumb" and ready for a Redis-Lua port.
 */
export interface IncrementOptions {
  windowMs: number
  limit: number
  blockDurationMs: number
  blockBackoff: number
  maxBlockDurationMs: number
  strikeResetMs: number
}

/**
 * The store counts hits AND decides blocking atomically - this contract is
 * shaped for a future Redis-Lua store where both happen in a single round trip.
 */
export interface StoreRecord {
  totalHits: number
  timeToExpireMs: number
  isBlocked: boolean
  timeToBlockExpireMs: number
  /** Accumulated strike count (geometric backoff). `0` when backoff is disabled. */
  strikes: number
}

export interface RateLimitStore {
  increment(key: string, opts: IncrementOptions): StoreRecord | Promise<StoreRecord>
  reset(key: string): void | Promise<void>
}

export type KeyGenerator = (ctx: RequestContext) => string | Promise<string>

export type HeadersMode = 'draft-6' | 'legacy' | false
