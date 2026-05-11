import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { RedisIdempotencyStore } from '../src/idempotency.js'

const REDIS_URL = process.env.REDIS_TEST_URL
const d = REDIS_URL ? describe : describe.skip

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

d('RedisIdempotencyStore', () => {
  let client: Redis
  let prefix: string
  let store: RedisIdempotencyStore

  beforeEach(async () => {
    client = new Redis(REDIS_URL!)
    prefix = `miia-test-idem:${randomUUID()}:`
    store = new RedisIdempotencyStore({ client, keyPrefix: prefix })
  })

  afterEach(async () => {
    const keys = await client.keys(`${prefix}*`)
    if (keys.length > 0) await client.del(...keys)
    await client.quit()
  })

  it('claim returns true on first call, false on subsequent calls', async () => {
    expect(await store.claim('a', 60_000)).toBe(true)
    expect(await store.claim('a', 60_000)).toBe(false)
  })

  it('different ids do not interfere', async () => {
    expect(await store.claim('a', 60_000)).toBe(true)
    expect(await store.claim('b', 60_000)).toBe(true)
    expect(await store.claim('a', 60_000)).toBe(false)
  })

  it('release allows the same id to be claimed again', async () => {
    expect(await store.claim('a', 60_000)).toBe(true)
    await store.release('a')
    expect(await store.claim('a', 60_000)).toBe(true)
  })

  it('release on non-existent id is a no-op', async () => {
    await store.release('never-claimed')
    expect(await store.claim('never-claimed', 60_000)).toBe(true)
  })

  it('TTL expires the entry on the Redis side', async () => {
    expect(await store.claim('a', 1000)).toBe(true)
    await wait(1100)
    expect(await store.claim('a', 1000)).toBe(true) // re-claimable after TTL
  })

  it('concurrent claims of the same id produce exactly one true', async () => {
    const results = await Promise.all([
      store.claim('a', 60_000),
      store.claim('a', 60_000),
      store.claim('a', 60_000),
      store.claim('a', 60_000),
    ])
    const trueCount = results.filter((r) => r === true).length
    expect(trueCount).toBe(1)
  })

  it('throws when neither url nor client is provided', () => {
    expect(() => new RedisIdempotencyStore({} as never)).toThrow(/either `url` or `client`/)
  })
})
