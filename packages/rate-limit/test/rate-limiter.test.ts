import { describe, expect, it } from 'bun:test'
import type { IncrementOptions, RateLimitStore, StoreRecord } from '../src/index.js'
import { MemoryStore, RateLimiter } from '../src/index.js'

class FakeStore implements RateLimitStore {
  lastIncrementKey?: string
  lastIncrementOpts?: IncrementOptions
  lastResetKey?: string
  record: StoreRecord

  constructor(initial: StoreRecord) {
    this.record = initial
  }

  async increment(key: string, opts: IncrementOptions): Promise<StoreRecord> {
    this.lastIncrementKey = key
    this.lastIncrementOpts = opts
    return this.record
  }

  async reset(key: string): Promise<void> {
    this.lastResetKey = key
  }
}

describe('RateLimiter', () => {
  it('returns the expected shape under, at and over the limit', async () => {
    const limiter = new RateLimiter({ limit: 2, window: 1000 })

    const first = await limiter.limit('a')
    expect(first).toMatchObject({ success: true, limit: 2, remaining: 1 })
    expect(first.resetMs).toBeGreaterThan(0)
    expect(first.retryAfterMs).toBeUndefined()

    const second = await limiter.limit('a')
    expect(second).toMatchObject({ success: true, limit: 2, remaining: 0 })

    const third = await limiter.limit('a')
    expect(third.success).toBe(false)
    expect(third.remaining).toBe(0)
    expect(third.retryAfterMs).toBeGreaterThan(0)
    expect(third.resetMs).toBeGreaterThan(0)
  })

  it('never throws on exceed', async () => {
    const limiter = new RateLimiter({ limit: 1, window: 1000 })
    await limiter.limit('a')
    await expect(limiter.limit('a')).resolves.toMatchObject({ success: false })
  })

  it('maps the blocked branch with retryAfterMs from the block duration', async () => {
    const limiter = new RateLimiter({ limit: 1, window: 100, blockDuration: 5000 })
    await limiter.limit('a')
    const blocked = await limiter.limit('a') // triggers the block
    expect(blocked.success).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.resetMs).toBe(5000)
    expect(blocked.retryAfterMs).toBe(5000)
  })

  it('isolates keys by prefix on a shared store', async () => {
    const store = new MemoryStore()
    const a = new RateLimiter({ limit: 1, window: 1000, store, prefix: 'a:' })
    const b = new RateLimiter({ limit: 1, window: 1000, store, prefix: 'b:' })

    expect((await a.limit('ip')).success).toBe(true)
    expect((await a.limit('ip')).success).toBe(false)
    // Same logical key, different prefix -> independent bucket.
    expect((await b.limit('ip')).success).toBe(true)
  })

  it('reset clears the bucket', async () => {
    const limiter = new RateLimiter({ limit: 1, window: 1000 })
    await limiter.limit('a')
    expect((await limiter.limit('a')).success).toBe(false)
    await limiter.reset('a')
    expect((await limiter.limit('a')).success).toBe(true)
  })

  it('throws when blockBackoff > 1 without maxBlockDuration', () => {
    expect(() => new RateLimiter({ limit: 1, window: 1000, blockDuration: 100, blockBackoff: 2 })).toThrow(
      'blockBackoff > 1 requires maxBlockDuration',
    )
  })

  it('throws when blockBackoff < 1', () => {
    expect(() => new RateLimiter({ limit: 1, window: 1000, blockBackoff: 0.5 })).toThrow('blockBackoff must be >= 1')
  })

  it('escalates the block geometrically end to end', async () => {
    const limiter = new RateLimiter({
      limit: 1,
      window: '40ms',
      blockDuration: '50ms',
      blockBackoff: 2,
      maxBlockDuration: '200ms',
      strikeReset: '1s',
    })

    await limiter.limit('a')
    const first = await limiter.limit('a') // exceed -> base ban
    expect(first.success).toBe(false)
    expect(first.retryAfterMs).toBe(50)

    await new Promise((r) => setTimeout(r, 70)) // block expires, strikes survive grace
    await limiter.limit('a')
    const second = await limiter.limit('a') // exceed -> base * 2
    expect(second.success).toBe(false)
    expect(second.retryAfterMs).toBe(100)
  })

  it('delegates to a custom async store and maps its StoreRecord', async () => {
    const store = new FakeStore({
      totalHits: 1,
      timeToExpireMs: 1000,
      isBlocked: false,
      timeToBlockExpireMs: 0,
      strikes: 0,
    })
    const limiter = new RateLimiter({ limit: 5, window: '1m', store, prefix: 'x:' })

    const ok = await limiter.limit('a')
    expect(ok).toMatchObject({ success: true, limit: 5, remaining: 4 })
    expect(store.lastIncrementKey).toBe('x:a')
    expect(store.lastIncrementOpts?.windowMs).toBe(60000)

    store.record = { totalHits: 99, timeToExpireMs: -1, isBlocked: true, timeToBlockExpireMs: 5000, strikes: 1 }
    const blocked = await limiter.limit('a')
    expect(blocked).toMatchObject({ success: false, remaining: 0, resetMs: 5000, retryAfterMs: 5000 })
  })

  it('reset() delegates to the custom store with the prefixed key', async () => {
    const store = new FakeStore({
      totalHits: 0,
      timeToExpireMs: 1000,
      isBlocked: false,
      timeToBlockExpireMs: 0,
      strikes: 0,
    })
    const limiter = new RateLimiter({ limit: 1, window: '1m', store, prefix: 'x:' })

    await limiter.reset('a')
    expect(store.lastResetKey).toBe('x:a')
  })
})
