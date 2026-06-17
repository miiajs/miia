import { MemoryStore } from './memory-store.js'
import type { RateLimitPolicy, RateLimitResult, RateLimitStore } from './types.js'
import { parseWindow } from './window.js'

export interface RateLimiterOptions extends RateLimitPolicy {
  /** @default new MemoryStore() */
  store?: RateLimitStore
  /** Key namespace prefix. @default '' */
  prefix?: string
}

/**
 * Core rate limiter. Upstash-style: `limit(key)` returns a result object and
 * never throws on exceed. Window/block durations are parsed once in the
 * constructor (fail fast on bad config).
 */
export class RateLimiter {
  readonly windowMs: number
  private readonly max: number
  private readonly blockDurationMs: number
  private readonly blockBackoff: number
  private readonly maxBlockDurationMs: number
  private readonly strikeResetMs: number
  private readonly store: RateLimitStore
  private readonly prefix: string

  constructor(options: RateLimiterOptions) {
    this.max = options.limit
    this.windowMs = parseWindow(options.window)
    this.blockDurationMs = options.blockDuration !== undefined ? parseWindow(options.blockDuration) : 0
    this.blockBackoff = options.blockBackoff ?? 1
    if (this.blockBackoff < 1) {
      throw new Error('[RateLimit] blockBackoff must be >= 1')
    }
    if (this.blockBackoff > 1 && options.maxBlockDuration === undefined) {
      throw new Error('[RateLimit] blockBackoff > 1 requires maxBlockDuration (unbounded escalation).')
    }
    this.maxBlockDurationMs =
      options.maxBlockDuration !== undefined ? parseWindow(options.maxBlockDuration) : this.blockDurationMs
    this.strikeResetMs = options.strikeReset !== undefined ? parseWindow(options.strikeReset) : this.maxBlockDurationMs
    this.store = options.store ?? new MemoryStore()
    this.prefix = options.prefix ?? ''
  }

  async limit(key: string): Promise<RateLimitResult> {
    const record = await this.store.increment(this.prefix + key, {
      windowMs: this.windowMs,
      limit: this.max,
      blockDurationMs: this.blockDurationMs,
      blockBackoff: this.blockBackoff,
      maxBlockDurationMs: this.maxBlockDurationMs,
      strikeResetMs: this.strikeResetMs,
    })

    if (record.isBlocked) {
      // Use timeToBlockExpireMs, not timeToExpireMs: when blockDuration > window
      // the window's expiresAt is already in the past (negative delta). For the
      // client, the end of the block IS when fresh quota becomes available.
      return {
        success: false,
        limit: this.max,
        remaining: 0,
        resetMs: record.timeToBlockExpireMs,
        retryAfterMs: record.timeToBlockExpireMs,
      }
    }

    const success = record.totalHits <= this.max
    const result: RateLimitResult = {
      success,
      limit: this.max,
      remaining: Math.max(0, this.max - record.totalHits),
      resetMs: record.timeToExpireMs,
    }
    if (!success) {
      result.retryAfterMs = record.timeToExpireMs
    }
    return result
  }

  async reset(key: string): Promise<void> {
    await this.store.reset(this.prefix + key)
  }
}
