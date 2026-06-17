import { describe, expect, it } from 'bun:test'
import { MemoryStore } from '../src/index.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const opts = (
  windowMs: number,
  limit: number,
  blockDurationMs: number,
  extra: Partial<{ blockBackoff: number; maxBlockDurationMs: number; strikeResetMs: number }> = {},
) => ({
  windowMs,
  limit,
  blockDurationMs,
  blockBackoff: 1,
  maxBlockDurationMs: 0,
  strikeResetMs: 0,
  ...extra,
})

describe('MemoryStore', () => {
  it('counts hits within a window', () => {
    const store = new MemoryStore()
    const a = store.increment('k', opts(1000, 3, 0))
    const b = store.increment('k', opts(1000, 3, 0))
    expect(a.totalHits).toBe(1)
    expect(b.totalHits).toBe(2)
    expect(a.isBlocked).toBe(false)
    expect(b.isBlocked).toBe(false)
  })

  it('reports over-limit hits without blocking when blockDuration is 0', () => {
    const store = new MemoryStore()
    store.increment('k', opts(1000, 1, 0))
    const over = store.increment('k', opts(1000, 1, 0))
    expect(over.totalHits).toBe(2)
    expect(over.isBlocked).toBe(false)
  })

  it('expires the window lazily and starts fresh', async () => {
    const store = new MemoryStore()
    store.increment('k', opts(50, 2, 0))
    store.increment('k', opts(50, 2, 0))
    await sleep(70)
    const fresh = store.increment('k', opts(50, 2, 0))
    expect(fresh.totalHits).toBe(1)
  })

  it('starts a block on the request that exceeds the limit', () => {
    const store = new MemoryStore()
    store.increment('k', opts(1000, 2, 5000))
    store.increment('k', opts(1000, 2, 5000))
    const triggering = store.increment('k', opts(1000, 2, 5000))
    expect(triggering.isBlocked).toBe(true)
    expect(triggering.timeToBlockExpireMs).toBe(5000)
  })

  it('does not increment hits while blocked', () => {
    const store = new MemoryStore()
    store.increment('k', opts(1000, 1, 5000))
    const triggering = store.increment('k', opts(1000, 1, 5000)) // hits = 2, block starts
    expect(triggering.isBlocked).toBe(true)
    const whileBlocked = store.increment('k', opts(1000, 1, 5000))
    expect(whileBlocked.isBlocked).toBe(true)
    expect(whileBlocked.totalHits).toBe(2) // unchanged
  })

  it('grants fresh quota after the block expires', async () => {
    const store = new MemoryStore()
    store.increment('k', opts(1000, 1, 50))
    const triggering = store.increment('k', opts(1000, 1, 50)) // block starts (50ms)
    expect(triggering.isBlocked).toBe(true)
    await sleep(70)
    const afterBlock = store.increment('k', opts(1000, 1, 50))
    expect(afterBlock.isBlocked).toBe(false)
    expect(afterBlock.totalHits).toBe(1)
  })

  it('sweeps fully-expired entries every 1024 increments, shrinking size', async () => {
    const store = new MemoryStore()
    store.increment('expired', opts(10, 100, 0))
    await sleep(30)
    // 1023 increments on a long-lived key bring the call count to the sweep boundary.
    for (let i = 0; i < 1023; i++) {
      store.increment('alive', opts(60_000, 1_000_000, 0))
    }
    expect(store.size).toBe(1) // 'expired' reclaimed, only 'alive' remains
  })

  it('reset removes the entry', () => {
    const store = new MemoryStore()
    store.increment('k', opts(1000, 5, 0))
    expect(store.size).toBe(1)
    store.reset('k')
    expect(store.size).toBe(0)
    const after = store.increment('k', opts(1000, 5, 0))
    expect(after.totalHits).toBe(1)
  })

  it('reports strikes as 0 when backoff is disabled', () => {
    const store = new MemoryStore()
    store.increment('k', opts(1000, 1, 50))
    const triggering = store.increment('k', opts(1000, 1, 50))
    expect(triggering.isBlocked).toBe(true)
    expect(triggering.strikes).toBe(0)
  })

  describe('geometric block backoff', () => {
    // base = 50ms, factor = 2, cap = 200ms, grace = 1s.
    const bo = (windowMs: number, limit: number, blockDurationMs: number) =>
      opts(windowMs, limit, blockDurationMs, { blockBackoff: 2, maxBlockDurationMs: 200, strikeResetMs: 1000 })

    // Drive the store through one full window + exceed -> returns the block record.
    const provoke = (store: MemoryStore) => {
      store.increment('k', bo(40, 1, 50)) // hit 1 (under limit)
      return store.increment('k', bo(40, 1, 50)) // hit 2 (exceeds -> block)
    }

    it('escalates the ban geometrically: base, base*f, base*f^2', async () => {
      const store = new MemoryStore()

      const first = provoke(store)
      expect(first.isBlocked).toBe(true)
      expect(first.timeToBlockExpireMs).toBe(50) // base, strikes were 0
      expect(first.strikes).toBe(1)

      await sleep(70) // block expires, window invalidated, strikes kept (grace = 1s)
      const second = provoke(store)
      expect(second.isBlocked).toBe(true)
      expect(second.timeToBlockExpireMs).toBe(100) // base * 2
      expect(second.strikes).toBe(2)

      await sleep(120) // block (100ms) expires
      const third = provoke(store)
      expect(third.isBlocked).toBe(true)
      expect(third.timeToBlockExpireMs).toBe(200) // base * 4, hits the cap exactly
      expect(third.strikes).toBe(3)
    })

    it('caps the ban at maxBlockDuration via Math.min', async () => {
      const store = new MemoryStore()

      provoke(store) // strikes -> 1, ban 50
      await sleep(70)
      provoke(store) // strikes -> 2, ban 100
      await sleep(120)
      provoke(store) // strikes -> 3, ban 200 (cap)
      await sleep(220)

      const fourth = provoke(store)
      expect(fourth.timeToBlockExpireMs).toBe(200) // base * 8 = 400, clamped to 200
      expect(fourth.strikes).toBe(4)
    })

    it('keeps strikes alive across block expiry within the grace period', async () => {
      const store = new MemoryStore()
      const first = provoke(store)
      expect(first.strikes).toBe(1)

      await sleep(70) // block expired, still well within the 1s grace
      // Next exceed must escalate (proves strikes survived), not restart at base.
      const second = provoke(store)
      expect(second.timeToBlockExpireMs).toBe(100)
      expect(second.strikes).toBe(2)
    })

    it('resets strikes fully after the grace period elapses (next ban = base)', async () => {
      const store = new MemoryStore()
      // base = 30ms, factor = 2, cap = 200ms, grace = 60ms.
      const g = (windowMs: number, limit: number, blockDurationMs: number) =>
        opts(windowMs, limit, blockDurationMs, { blockBackoff: 2, maxBlockDurationMs: 200, strikeResetMs: 60 })
      const provokeG = (s: MemoryStore) => {
        s.increment('k', g(20, 1, 30))
        return s.increment('k', g(20, 1, 30))
      }

      const first = provokeG(store)
      expect(first.timeToBlockExpireMs).toBe(30) // base
      expect(first.strikes).toBe(1)

      // Wait for block (30ms) + grace (60ms) to elapse -> strikes decay.
      await sleep(120)
      const afterGrace = provokeG(store)
      expect(afterGrace.timeToBlockExpireMs).toBe(30) // back to base
      expect(afterGrace.strikes).toBe(1)
    })

    it('disabled backoff deletes the entry after the block (fresh quota, no strike memory)', async () => {
      const store = new MemoryStore()
      store.increment('k', opts(1000, 1, 50))
      const triggering = store.increment('k', opts(1000, 1, 50)) // block 50ms, no backoff
      expect(triggering.isBlocked).toBe(true)
      expect(triggering.strikes).toBe(0)

      await sleep(70)
      const after = store.increment('k', opts(1000, 1, 50))
      expect(after.isBlocked).toBe(false)
      expect(after.totalHits).toBe(1) // fresh window
      expect(after.strikes).toBe(0)
    })

    it('does not sweep an entry whose strikesExpireAt is in the future', async () => {
      const store = new MemoryStore()
      // Provoke a block with a long grace so strikesExpireAt stays in the future.
      store.increment('k', opts(20, 1, 30, { blockBackoff: 2, maxBlockDurationMs: 200, strikeResetMs: 60_000 }))
      store.increment('k', opts(20, 1, 30, { blockBackoff: 2, maxBlockDurationMs: 200, strikeResetMs: 60_000 }))
      await sleep(60) // window + block expired, but strikesExpireAt far in the future

      // Push the call count to the sweep boundary on a different key.
      for (let i = 0; i < 1022; i++) {
        store.increment('alive', opts(60_000, 1_000_000, 0))
      }
      expect(store.size).toBe(2) // 'k' kept (live strike memory) + 'alive'
    })
  })
})
