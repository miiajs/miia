import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { LoggerService } from '@miiajs/core'
import { Redis } from 'ioredis'
import { RedisIdempotencyStore } from '../src/idempotency.js'
import { closedPort, freezingProxy, waitFor } from './helpers.js'

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

interface StoreLogs {
  errors: string[]
  errorDetails: string[]
  logs: string[]
}

function captureStoreLogs(store: RedisIdempotencyStore): StoreLogs {
  const captured: StoreLogs = { errors: [], errorDetails: [], logs: [] }
  const recorder: LoggerService = {
    log: (message) => {
      captured.logs.push(message)
    },
    warn: () => {},
    error: (message, trace) => {
      captured.errors.push(message)
      captured.errorDetails.push(trace ?? '')
    },
    debug: () => {},
  }
  ;(store as unknown as { logger: LoggerService }).logger = recorder
  return captured
}

describe('RedisIdempotencyStore connection errors', () => {
  it('logs the first error of an outage through the logger instead of an unhandled ioredis error', async () => {
    const unhandled = spyOn(console, 'error')
    const store = new RedisIdempotencyStore({ url: `redis://localhost:${await closedPort()}` })
    const logs = captureStoreLogs(store)
    const client = (store as unknown as { client: Redis }).client
    let seen = 0
    client.on('error', () => seen++)
    try {
      // Not awaited: the offline queue holds it through every reconnect attempt.
      store.claim('a', 60_000).catch(() => {})
      await waitFor(() => seen >= 3, 'three connection errors')

      expect(logs.errors).toEqual(['Redis connection error'])
      expect(logs.errorDetails[0]).toContain('ECONNREFUSED')
      expect(unhandled.mock.calls.filter(([first]) => String(first).includes('Unhandled error event'))).toEqual([])
    } finally {
      client.disconnect()
      unhandled.mockRestore()
    }
  })

  const r = REDIS_URL ? it : it.skip
  r('logs one recovery line when the connection comes back', async () => {
    const port = await closedPort()
    const store = new RedisIdempotencyStore({
      url: `redis://127.0.0.1:${port}`,
      keyPrefix: `miia-test-idem:${randomUUID()}:`,
    })
    const logs = captureStoreLogs(store)
    const client = (store as unknown as { client: Redis }).client
    let seen = 0
    client.on('error', () => seen++)
    const claim = store.claim('a', 1000)
    await waitFor(() => seen >= 2, 'two connection errors')
    // Redis shows up on the port the store keeps retrying.
    const proxy = await freezingProxy(port)
    try {
      expect(await claim).toBe(true)
      expect(logs.logs).toEqual([`Redis connection recovered after ${seen} errors`])
    } finally {
      await store.onDestroy()
      await proxy.close()
    }
  })
})
