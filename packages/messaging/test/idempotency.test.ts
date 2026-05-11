import { describe, expect, it } from 'bun:test'
import { MemoryIdempotencyStore, memoryIdempotencyStore } from '../src/idempotency.js'

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('MemoryIdempotencyStore', () => {
  it('claim returns true on first call, false on subsequent calls', async () => {
    const store = memoryIdempotencyStore()
    expect(await store.claim('a', 60_000)).toBe(true)
    expect(await store.claim('a', 60_000)).toBe(false)
    expect(await store.claim('a', 60_000)).toBe(false)
  })

  it('different ids do not interfere', async () => {
    const store = memoryIdempotencyStore()
    expect(await store.claim('a', 60_000)).toBe(true)
    expect(await store.claim('b', 60_000)).toBe(true)
    expect(await store.claim('a', 60_000)).toBe(false)
    expect(await store.claim('b', 60_000)).toBe(false)
  })

  it('release allows the same id to be claimed again', async () => {
    const store = memoryIdempotencyStore()
    expect(await store.claim('a', 60_000)).toBe(true)
    await store.release('a')
    expect(await store.claim('a', 60_000)).toBe(true)
  })

  it('release on a non-existent id is a no-op', async () => {
    const store = memoryIdempotencyStore()
    await store.release('never-claimed') // should not throw
    expect(await store.claim('never-claimed', 60_000)).toBe(true)
  })

  it('expired entry is treated as absent', async () => {
    const store = new MemoryIdempotencyStore()
    // 50ms TTL → expires within 50ms
    expect(await store.claim('a', 50)).toBe(true)
    await wait(80)
    expect(await store.claim('a', 50)).toBe(true) // re-claimable after TTL
  })

  it('LRU evicts oldest entry when maxSize is exceeded', async () => {
    const store = new MemoryIdempotencyStore({ maxSize: 2 })
    // step 1: ['a']
    expect(await store.claim('a', 60_000)).toBe(true)
    // step 2: ['a', 'b']
    expect(await store.claim('b', 60_000)).toBe(true)
    // step 3: 'c' pushes size to 3 → oldest 'a' evicted → ['b', 'c']
    expect(await store.claim('c', 60_000)).toBe(true)
    // 'a' was evicted, re-claimable
    expect(await store.claim('a', 60_000)).toBe(true)
    // 'c' is still in store (not evicted yet)
    expect(await store.claim('c', 60_000)).toBe(false)
  })

  it('onDestroy clears all entries', async () => {
    const store = memoryIdempotencyStore()
    await store.claim('a', 60_000)
    await store.claim('b', 60_000)
    await store.onDestroy?.()
    expect(await store.claim('a', 60_000)).toBe(true) // store cleared
    expect(await store.claim('b', 60_000)).toBe(true)
  })

  it('concurrent claims of the same id produce exactly one true', async () => {
    const store = memoryIdempotencyStore()
    const results = await Promise.all([
      store.claim('a', 60_000),
      store.claim('a', 60_000),
      store.claim('a', 60_000),
      store.claim('a', 60_000),
    ])
    const trueCount = results.filter((r) => r === true).length
    expect(trueCount).toBe(1)
  })
})
