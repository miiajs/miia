import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { MessageEnvelope, HandlerResult } from '@miiajs/messaging'
import type { Redis } from 'ioredis'
import { RedisStreamsTransport } from '../src/redis-streams-transport.js'
import { closeClientsAfterEach, testClient } from './helpers.js'

const REDIS_URL = process.env.REDIS_TEST_URL
const d = REDIS_URL ? describe : describe.skip

closeClientsAfterEach()

/**
 * Housekeeping cadence parked far past the lifetime of a test. The tests using it measure publish latency, shutdown
 * timing or dispatch ordering, and a retry pass landing mid-measurement would show up as noise in the numbers rather
 * than as a failure anyone could read. Retry behaviour itself lives in `retry.test.ts`.
 */
const NO_HOUSEKEEPING = 60_000

function envelope(topic: string, payload: unknown = {}): MessageEnvelope {
  return {
    id: randomUUID(),
    topic,
    payload,
    meta: { timestamp: Date.now(), attempt: 1 },
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function drainKeys(client: Redis, prefix: string): Promise<void> {
  const keys = await client.keys(`${prefix}*`)
  if (keys.length > 0) await client.del(...keys)
}

d('RedisStreamsTransport', () => {
  let client: Redis
  let transport: RedisStreamsTransport
  let topic: string

  beforeEach(async () => {
    client = testClient()
    topic = `miia-test:${randomUUID()}`
    transport = new RedisStreamsTransport({
      client,
      retry: { backoffMs: 50, maxAttempts: 3 },
      retryIntervalMs: 50,
      blockMs: 200,
    })
    await transport.onInit?.()
  })

  afterEach(async () => {
    await transport.onDestroy?.()
    await drainKeys(testClient(), topic)
  })

  it('publishes and delivers to a subscriber', async () => {
    const received: MessageEnvelope[] = []
    await transport.subscribe(
      topic,
      async (e) => {
        received.push(e)
        return { status: 'ack' }
      },
      { group: 'g' },
    )
    // Give the consumer loop a moment to start blocking on XREADGROUP.
    await wait(50)

    await transport.publish(envelope(topic, { hello: 'world' }))
    await wait(300)

    expect(received).toHaveLength(1)
    expect(received[0]?.payload).toEqual({ hello: 'world' })
    expect(received[0]?.meta.attempt).toBe(1)
  })

  it('load-balances within the same consumer group', async () => {
    // Two subscribers joining the SAME group should split deliveries.
    // Use a second transport so each has its own consumer name.
    const otherClient = testClient()
    const other = new RedisStreamsTransport({
      client: otherClient,
      retry: { backoffMs: 50, maxAttempts: 3 },
      retryIntervalMs: 50,
      blockMs: 200,
    })
    await other.onInit?.()

    const receivedA: string[] = []
    const receivedB: string[] = []

    await transport.subscribe(
      topic,
      async (e) => {
        receivedA.push((e.payload as { id: string }).id)
        return { status: 'ack' }
      },
      { group: 'shared' },
    )
    await other.subscribe(
      topic,
      async (e) => {
        receivedB.push((e.payload as { id: string }).id)
        return { status: 'ack' }
      },
      { group: 'shared' },
    )
    await wait(100)

    for (let i = 0; i < 10; i++) {
      await transport.publish(envelope(topic, { id: String(i) }))
    }
    await wait(600)

    expect(receivedA.length + receivedB.length).toBe(10)
    // Each consumer should have received at least one message in a healthy distribution.
    expect(receivedA.length).toBeGreaterThan(0)
    expect(receivedB.length).toBeGreaterThan(0)

    await other.onDestroy?.()
  })

  it('fans out across different consumer groups', async () => {
    const groupA: MessageEnvelope[] = []
    const groupB: MessageEnvelope[] = []

    await transport.subscribe(
      topic,
      async (e) => {
        groupA.push(e)
        return { status: 'ack' }
      },
      { group: 'group-a' },
    )
    await transport.subscribe(
      topic,
      async (e) => {
        groupB.push(e)
        return { status: 'ack' }
      },
      { group: 'group-b' },
    )
    await wait(100)

    await transport.publish(envelope(topic, { id: 1 }))
    await wait(400)

    expect(groupA).toHaveLength(1)
    expect(groupB).toHaveLength(1)
    expect(groupA[0]?.payload).toEqual({ id: 1 })
    expect(groupB[0]?.payload).toEqual({ id: 1 })
  })

  it('unsubscribe stops consumer loop without errors', async () => {
    const sub = await transport.subscribe(topic, async () => ({ status: 'ack' }), { group: 'g' })
    await wait(50)
    await sub.unsubscribe()
    // If the loop did not cleanly abort, onDestroy later would hang.
    // The test passes if we reach this point without an unhandled error.
    expect(true).toBe(true)
  })

  it('onDestroy waits for in-flight handler before quitting the client', async () => {
    // Standalone transport so we can configure drainTimeoutMs without touching
    // the shared one in beforeEach.
    const client2 = testClient()
    const topic2 = `miia-test:${randomUUID()}`
    const t = new RedisStreamsTransport({
      client: client2,
      retry: { backoffMs: 50, maxAttempts: 3 },
      retryIntervalMs: 50,
      blockMs: 100,
      drainTimeoutMs: 2000,
    })
    await t.onInit?.()

    let handlerFinished = false
    await t.subscribe(
      topic2,
      async () => {
        await wait(150)
        handlerFinished = true
        return { status: 'ack' }
      },
      { group: 'g' },
    )
    await wait(50) // consumer ready

    await t.publish(envelope(topic2, {}))
    await wait(150) // handler picks up and starts running

    const destroyStart = Date.now()
    await t.onDestroy?.()
    const elapsed = Date.now() - destroyStart

    expect(handlerFinished).toBe(true)
    // drain must have waited; allow a wide window because xreadgroup BLOCK
    // can cost up to blockMs on top of handler runtime.
    expect(elapsed).toBeLessThan(2500)

    // cleanup the test stream so afterEach drainKeys is enough
    await drainKeys(testClient(), topic2)
  })

  describe('connection isolation', () => {
    // Each test below builds its own standalone transport because the shared
    // beforeEach uses blockMs: 200, which would mask the contention these
    // tests exist to verify. Pattern mirrors 'onDestroy waits for in-flight
    // handler' above.

    it('publish latency does not degrade with active blocking subscribers', async () => {
      const c = testClient()
      const t = new RedisStreamsTransport({
        client: c,
        retry: { backoffMs: 50, maxAttempts: 3 },
        retryIntervalMs: NO_HOUSEKEEPING,
        blockMs: 5000,
      })
      await t.onInit?.()

      const subscribedTopics: string[] = []
      try {
        for (let i = 0; i < 5; i++) {
          const tp = `miia-test:isolation-a:${randomUUID()}`
          subscribedTopics.push(tp)
          await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g' })
        }
        // Let all 5 consumer loops settle into BLOCK 5000.
        await wait(150)

        const publishTopic = `miia-test:isolation-a:pub:${randomUUID()}`
        const samples: number[] = []
        for (let i = 0; i < 50; i++) {
          const start = Date.now()
          await t.publish(envelope(publishTopic, { i }))
          samples.push(Date.now() - start)
        }

        const max = Math.max(...samples)
        // Localhost RTT is ~1 ms; 100 ms is a generous ceiling that the
        // pre-fix single-client implementation would blow past (1-5 s).
        expect(max).toBeLessThan(100)
      } finally {
        await t.onDestroy?.()
        const cleanup = testClient()
        for (const tp of subscribedTopics) await drainKeys(cleanup, tp)
      }
    })

    it('publish proceeds while a subscriber is mid-BLOCK on a long timeout', async () => {
      const c = testClient()
      const t = new RedisStreamsTransport({
        client: c,
        retry: { backoffMs: 50, maxAttempts: 3 },
        retryIntervalMs: NO_HOUSEKEEPING,
        blockMs: 30_000,
      })
      await t.onInit?.()

      const blockedTopic = `miia-test:isolation-b:blocked:${randomUUID()}`
      const publishTopic = `miia-test:isolation-b:pub:${randomUUID()}`
      try {
        await t.subscribe(blockedTopic, async () => ({ status: 'ack' }), { group: 'g' })
        // Wait long enough that the consumer is firmly inside XREADGROUP BLOCK.
        await wait(200)

        const start = Date.now()
        await t.publish(envelope(publishTopic, { ping: true }))
        const elapsed = Date.now() - start

        expect(elapsed).toBeLessThan(100)
      } finally {
        await t.onDestroy?.()
        const cleanup = testClient()
        await drainKeys(cleanup, blockedTopic)
        await drainKeys(cleanup, publishTopic)
      }
    })

    it('onDestroy disconnects all subClients deterministically', async () => {
      const c = testClient()
      const t = new RedisStreamsTransport({
        client: c,
        retry: { backoffMs: 50, maxAttempts: 3 },
        retryIntervalMs: NO_HOUSEKEEPING,
        blockMs: 30_000,
        drainTimeoutMs: 5000,
      })
      await t.onInit?.()

      const topics: string[] = []
      try {
        for (let i = 0; i < 2; i++) {
          const tp = `miia-test:isolation-c:${randomUUID()}`
          topics.push(tp)
          await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g' })
        }
        await wait(150)

        // Capture lane.client refs through a typed view of the private state.
        const subs = (t as unknown as { subs: Array<{ lanes: Array<{ client: Redis }> }> }).subs
        expect(subs).toHaveLength(2)
        // Batch mode = exactly one lane per subscription.
        expect(subs.every((s) => s.lanes.length === 1)).toBe(true)
        const captured = subs.flatMap((s) => s.lanes.map((l) => l.client))

        const destroyStart = Date.now()
        await t.onDestroy?.()
        const elapsed = Date.now() - destroyStart

        // Destroy must not wait for blockMs (30 s) - subClients are
        // disconnected synchronously, BLOCK throws, loop exits.
        expect(elapsed).toBeLessThan(2000)
        // ioredis disconnect() initiates socket close synchronously but the
        // status transition (ready → close → end) flows through async events.
        // Give it one tick to settle, then assert any terminal state.
        await wait(50)
        for (const sc of captured) {
          expect(['end', 'close']).toContain(sc.status)
        }
      } finally {
        const cleanup = testClient()
        for (const tp of topics) await drainKeys(cleanup, tp)
      }
    })
  })

  describe('dispatch modes', () => {
    // Helper - peek at private subs state for assertions.
    function getSubs(t: RedisStreamsTransport): Array<{
      mode: 'batch' | 'sliding'
      concurrency: number
      lanes: Array<{ client: Redis; consumer: string }>
    }> {
      return (
        t as unknown as {
          subs: Array<{
            mode: 'batch' | 'sliding'
            concurrency: number
            lanes: Array<{ client: Redis; consumer: string }>
          }>
        }
      ).subs
    }

    it('declares supportedModes=["batch","sliding"] and defaultMode="batch"', () => {
      expect(transport.supportedModes).toEqual(['batch', 'sliding'])
      expect(transport.defaultMode).toBe('batch')
    })

    it('batch mode head-of-line: next read waits for the current batch to settle', async () => {
      const c = testClient()
      const tp = `miia-test:dispatch-batch:${randomUUID()}`
      const t = new RedisStreamsTransport({
        client: c,
        retry: { backoffMs: 50, maxAttempts: 3 },
        retryIntervalMs: NO_HOUSEKEEPING,
        blockMs: 100,
      })
      await t.onInit?.()

      const completionOrder: number[] = []
      try {
        // 5 messages in one batch: msg 0 slow (500ms), msg 1-4 fast (50ms).
        await t.subscribe(
          tp,
          async (e): Promise<HandlerResult> => {
            const id = (e.payload as { i: number }).i
            await wait(id === 0 ? 500 : 50)
            completionOrder.push(id)
            return { status: 'ack' }
          },
          { group: 'g', mode: 'batch', concurrency: 5 },
        )
        await wait(50)

        for (let i = 0; i < 5; i++) await t.publish(envelope(tp, { i }))

        // Wait for first batch to fully settle (msg 0 is the slow one).
        await wait(700)
        expect(completionOrder.sort()).toEqual([0, 1, 2, 3, 4])

        // Now publish msg 5; it must have been blocked behind msg 0's barrier.
        // We've already waited past msg 0, so the next XREADGROUP should pick up msg 5
        // immediately. Check that msg 5 lands AFTER msg 0 in completion order.
        await t.publish(envelope(tp, { i: 5 }))
        await wait(300)
        expect(completionOrder).toContain(5)
        const idx0 = completionOrder.indexOf(0)
        const idx5 = completionOrder.indexOf(5)
        expect(idx5).toBeGreaterThan(idx0)
      } finally {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    it('sliding mode: fast handlers complete before a slow one (no head-of-line)', async () => {
      const c = testClient()
      const tp = `miia-test:dispatch-sliding:${randomUUID()}`
      const t = new RedisStreamsTransport({
        client: c,
        retry: { backoffMs: 50, maxAttempts: 3 },
        retryIntervalMs: NO_HOUSEKEEPING,
        blockMs: 100,
      })
      await t.onInit?.()

      const completionOrder: number[] = []
      try {
        await t.subscribe(
          tp,
          async (e): Promise<HandlerResult> => {
            const id = (e.payload as { i: number }).i
            await wait(id === 0 ? 600 : 50)
            completionOrder.push(id)
            return { status: 'ack' }
          },
          { group: 'g', mode: 'sliding', concurrency: 4 },
        )
        await wait(80)

        // Slow message first, then 3 fast ones.
        await t.publish(envelope(tp, { i: 0 }))
        await wait(20)
        for (let i = 1; i < 4; i++) await t.publish(envelope(tp, { i }))

        // Fast messages (50ms) finish well before the slow one (600ms).
        await wait(800)

        expect(completionOrder).toHaveLength(4)
        // Msg 0 is the LAST one in completion order despite being published first.
        expect(completionOrder[completionOrder.length - 1]).toBe(0)
      } finally {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    it('sliding mode creates concurrency lanes with :laneN consumer names', async () => {
      const c = testClient()
      const tp = `miia-test:dispatch-lanes:${randomUUID()}`
      const t = new RedisStreamsTransport({
        client: c,
        blockMs: 200,
      })
      await t.onInit?.()

      try {
        await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g', mode: 'sliding', concurrency: 3 })
        await wait(50)

        const subs = getSubs(t)
        expect(subs).toHaveLength(1)
        expect(subs[0]!.mode).toBe('sliding')
        expect(subs[0]!.lanes).toHaveLength(3)
        const consumers = subs[0]!.lanes.map((l) => l.consumer)
        expect(consumers[0]).toMatch(/:lane0$/)
        expect(consumers[1]).toMatch(/:lane1$/)
        expect(consumers[2]).toMatch(/:lane2$/)
      } finally {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    it('batch mode creates exactly one lane regardless of concurrency', async () => {
      const c = testClient()
      const tp = `miia-test:dispatch-batch-lanes:${randomUUID()}`
      const t = new RedisStreamsTransport({
        client: c,
        blockMs: 200,
      })
      await t.onInit?.()

      try {
        await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g', mode: 'batch', concurrency: 8 })
        await wait(50)

        const subs = getSubs(t)
        expect(subs[0]!.mode).toBe('batch')
        expect(subs[0]!.lanes).toHaveLength(1)
        // Batch lane uses the base consumer name without :laneN suffix.
        expect(subs[0]!.lanes[0]!.consumer).not.toMatch(/:lane\d+$/)
      } finally {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    it('sliding lane cleanup on unsubscribe disconnects every lane client', async () => {
      const c = testClient()
      const tp = `miia-test:dispatch-cleanup:${randomUUID()}`
      const t = new RedisStreamsTransport({
        client: c,
        blockMs: 30_000,
      })
      await t.onInit?.()

      try {
        const sub = await t.subscribe(tp, async () => ({ status: 'ack' }), {
          group: 'g',
          mode: 'sliding',
          concurrency: 3,
        })
        await wait(150)

        const subs = getSubs(t)
        const captured = subs[0]!.lanes.map((l) => l.client)
        expect(captured).toHaveLength(3)

        await sub.unsubscribe()
        await wait(50)

        for (const cli of captured) {
          expect(['end', 'close']).toContain(cli.status)
        }
      } finally {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    it('sliding lane cleanup on onDestroy disconnects every lane client across subs', async () => {
      const c = testClient()
      const t = new RedisStreamsTransport({
        client: c,
        blockMs: 30_000,
        drainTimeoutMs: 1000,
      })
      await t.onInit?.()

      const topics: string[] = []
      try {
        for (let i = 0; i < 2; i++) {
          const tp = `miia-test:dispatch-destroy:${randomUUID()}`
          topics.push(tp)
          await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g', mode: 'sliding', concurrency: 2 })
        }
        await wait(150)

        const subs = getSubs(t)
        const captured = subs.flatMap((s) => s.lanes.map((l) => l.client))
        expect(captured).toHaveLength(4) // 2 subs × 2 lanes

        await t.onDestroy?.()
        await wait(50)

        for (const cli of captured) {
          expect(['end', 'close']).toContain(cli.status)
        }
      } finally {
        const cleanup = testClient()
        for (const tp of topics) await drainKeys(cleanup, tp)
      }
    })
  })

  describe('broadcast group lifecycle', () => {
    // Helper to read group names for a topic via XINFO GROUPS.
    async function listGroupNames(client: Redis, topic: string): Promise<string[]> {
      try {
        const raw = (await (client as unknown as { xinfo: (...args: unknown[]) => Promise<unknown> }).xinfo(
          'GROUPS',
          topic,
        )) as Array<[string, ...unknown[]]>
        return raw.map((g) => String(g[1]))
      } catch (err) {
        if (String(err).includes('NOGROUP') || String(err).includes('no such key')) return []
        throw err
      }
    }

    it('subscribe with broadcast group destroys orphaned same-host groups from previous incarnations', async () => {
      const c = testClient()
      const tp = `miia-test:bcast-orphan:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: c, blockMs: 200 })
      await t.onInit?.()

      try {
        // Pre-create an "orphan" group as if it was left by a previous pid on this host.
        const host = (await import('node:os')).hostname()
        const myPid = String(process.pid)
        const orphanPid = String(Number(myPid) + 99999) // definitely not us
        const base = `${tp}__OrphanService_run`
        const orphanGroup = `${base}__${host}_${orphanPid}`
        const currentGroup = `${base}__${host}_${myPid}`

        // Stream + group must exist for cleanup target to exist.
        await c.xgroup('CREATE', tp, orphanGroup, '$', 'MKSTREAM').catch((err) => {
          if (!String(err).includes('BUSYGROUP')) throw err
        })

        const before = await listGroupNames(c, tp)
        expect(before).toContain(orphanGroup)

        // Now subscribe with the current-pid broadcast group; cleanup runs.
        await t.subscribe(tp, async () => ({ status: 'ack' }), {
          group: currentGroup,
          mode: 'batch',
          concurrency: 1,
          broadcast: true,
        })

        const after = await listGroupNames(c, tp)
        expect(after).toContain(currentGroup)
        expect(after).not.toContain(orphanGroup)
      } finally {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    it('does not destroy groups from a different hostname', async () => {
      const c = testClient()
      const tp = `miia-test:bcast-otherhost:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: c, blockMs: 200 })
      await t.onInit?.()

      try {
        const host = (await import('node:os')).hostname()
        const myPid = String(process.pid)
        const base = `${tp}__Service_run`
        const otherHostGroup = `${base}__some-other-host_999`
        const currentGroup = `${base}__${host}_${myPid}`

        await c.xgroup('CREATE', tp, otherHostGroup, '$', 'MKSTREAM').catch((err) => {
          if (!String(err).includes('BUSYGROUP')) throw err
        })

        await t.subscribe(tp, async () => ({ status: 'ack' }), {
          group: currentGroup,
          mode: 'batch',
          concurrency: 1,
          broadcast: true,
        })

        const after = await listGroupNames(c, tp)
        expect(after).toContain(currentGroup)
        // Other-host group must remain - cleanup is host-anchored
        expect(after).toContain(otherHostGroup)
      } finally {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    it('does not destroy groups with a mismatched prefix (different handler/topic)', async () => {
      const c = testClient()
      const tp = `miia-test:bcast-prefix:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: c, blockMs: 200 })
      await t.onInit?.()

      try {
        const host = (await import('node:os')).hostname()
        const myPid = String(process.pid)
        const unrelatedGroup = `${tp}__OtherHandler_other__${host}_999`
        const currentGroup = `${tp}__MyHandler_run__${host}_${myPid}`

        await c.xgroup('CREATE', tp, unrelatedGroup, '$', 'MKSTREAM').catch((err) => {
          if (!String(err).includes('BUSYGROUP')) throw err
        })

        await t.subscribe(tp, async () => ({ status: 'ack' }), {
          group: currentGroup,
          mode: 'batch',
          concurrency: 1,
          broadcast: true,
        })

        const after = await listGroupNames(c, tp)
        expect(after).toContain(currentGroup)
        // Different handler prefix → cleanup leaves it alone.
        expect(after).toContain(unrelatedGroup)
      } finally {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    it('onDestroy destroys current process broadcast groups', async () => {
      const c = testClient()
      const tp = `miia-test:bcast-destroy:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: c, blockMs: 200, drainTimeoutMs: 200 })
      await t.onInit?.()

      const host = (await import('node:os')).hostname()
      const myPid = String(process.pid)
      const currentGroup = `${tp}__Cache_flush__${host}_${myPid}`

      await t.subscribe(tp, async () => ({ status: 'ack' }), {
        group: currentGroup,
        mode: 'batch',
        concurrency: 1,
        broadcast: true,
      })
      await wait(50)

      const before = await listGroupNames(c, tp)
      expect(before).toContain(currentGroup)

      await t.onDestroy?.()

      // Reuse a fresh client to verify; the transport's own client may be closing.
      const verify = testClient()
      try {
        const after = await listGroupNames(verify, tp)
        expect(after).not.toContain(currentGroup)
      } finally {
        await drainKeys(verify, tp)
      }
    })

    it('non-broadcast subscribe does not run orphan scan', async () => {
      // Pre-create a fake "orphan-looking" group; non-broadcast subscribe must not touch it.
      const c = testClient()
      const tp = `miia-test:bcast-skip:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: c, blockMs: 200 })
      await t.onInit?.()

      try {
        const host = (await import('node:os')).hostname()
        const lookalikeGroup = `${tp}__Foo_bar__${host}_77777`
        await c.xgroup('CREATE', tp, lookalikeGroup, '$', 'MKSTREAM').catch((err) => {
          if (!String(err).includes('BUSYGROUP')) throw err
        })

        // Regular (non-broadcast) subscribe with explicit group.
        await t.subscribe(tp, async () => ({ status: 'ack' }), {
          group: 'workers',
          mode: 'batch',
          concurrency: 1,
          broadcast: false,
        })

        const after = await listGroupNames(c, tp)
        expect(after).toContain('workers')
        expect(after).toContain(lookalikeGroup)
      } finally {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })
  })
})
