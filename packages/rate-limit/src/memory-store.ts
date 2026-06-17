import type { IncrementOptions, RateLimitStore, StoreRecord } from './types.js'

interface Entry {
  hits: number
  expiresAt: number
  blockExpiresAt: number
  strikes: number
  /** When accumulated strikes reset to zero. `0` = no strike memory. */
  strikesExpireAt: number
}

const SWEEP_INTERVAL = 1024

/**
 * In-memory fixed-window store. No timers (unref semantics differ across
 * runtimes) - expired entries are reclaimed lazily and via a periodic sweep
 * every {@link SWEEP_INTERVAL} increments.
 */
export class MemoryStore implements RateLimitStore {
  private store = new Map<string, Entry>()
  private calls = 0

  increment(key: string, opts: IncrementOptions): StoreRecord {
    const { windowMs, limit, blockDurationMs, blockBackoff, maxBlockDurationMs, strikeResetMs } = opts
    const backoff = blockBackoff > 1
    const now = Date.now()

    // 1. Periodic sweep of fully-expired entries (keep those with live strike memory).
    if (++this.calls % SWEEP_INTERVAL === 0) {
      for (const [k, entry] of this.store) {
        if (entry.expiresAt <= now && entry.blockExpiresAt <= now && entry.strikesExpireAt <= now) {
          this.store.delete(k)
        }
      }
    }

    let entry = this.store.get(key)

    // 2. Currently blocked -> return blocked, do NOT count this hit.
    if (entry && entry.blockExpiresAt > now) {
      return {
        totalHits: entry.hits,
        timeToExpireMs: entry.expiresAt - now,
        isBlocked: true,
        timeToBlockExpireMs: entry.blockExpiresAt - now,
        strikes: entry.strikes,
      }
    }

    // 3. Block has expired. With backoff and live strike memory, invalidate only the
    //    window (keep strikes/strikesExpireAt) so the next exceed escalates. Without
    //    backoff (or once the grace has elapsed) drop the entry entirely (fresh start).
    if (entry && entry.blockExpiresAt > 0 && entry.blockExpiresAt <= now) {
      if (backoff && entry.strikesExpireAt > now) {
        entry.expiresAt = 0
      } else {
        this.store.delete(key)
        entry = undefined
      }
    }

    // 3b. Strike memory has elapsed -> reset strikes (clean slate, next ban = base).
    if (entry && entry.strikes > 0 && entry.strikesExpireAt <= now) {
      entry.strikes = 0
      entry.strikesExpireAt = 0
    }

    // 4. No entry / window expired -> new window (carry strike memory); otherwise count.
    if (!entry || entry.expiresAt <= now) {
      entry = {
        hits: 1,
        expiresAt: now + windowMs,
        blockExpiresAt: 0,
        strikes: entry?.strikes ?? 0,
        strikesExpireAt: entry?.strikesExpireAt ?? 0,
      }
      this.store.set(key, entry)
    } else {
      entry.hits++
    }

    // 5. Over limit + blocking enabled -> start the block now. This very request
    //    already reports as blocked with the full block duration as Retry-After.
    if (entry.hits > limit && blockDurationMs > 0 && entry.blockExpiresAt === 0) {
      const blockMs = backoff
        ? Math.min(maxBlockDurationMs, blockDurationMs * blockBackoff ** entry.strikes)
        : blockDurationMs
      entry.blockExpiresAt = now + blockMs
      if (backoff) {
        entry.strikes++
        entry.strikesExpireAt = entry.blockExpiresAt + strikeResetMs
      }
      return {
        totalHits: entry.hits,
        timeToExpireMs: entry.expiresAt - now,
        isBlocked: true,
        timeToBlockExpireMs: blockMs,
        strikes: entry.strikes,
      }
    }

    // 6. Normal record.
    return {
      totalHits: entry.hits,
      timeToExpireMs: entry.expiresAt - now,
      isBlocked: false,
      timeToBlockExpireMs: 0,
      strikes: entry.strikes,
    }
  }

  reset(key: string): void {
    this.store.delete(key)
  }

  /** @internal Test-only view of the number of tracked entries. */
  get size(): number {
    return this.store.size
  }
}
