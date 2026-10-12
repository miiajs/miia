import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { MessageEnvelope, HandlerResult } from '@miiajs/messaging'
import { Redis } from 'ioredis'
import { ALIVE_KEY_PREFIX } from '../src/constants.js'
import { RedisStreamsTransport } from '../src/redis-streams-transport.js'
import { type CapturedLogs, captureLogs, closeClientsAfterEach, closedPort, testClient, waitFor } from './helpers.js'

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
        // Liveness keys are per host + pid and outlive their tests, so make sure this pid's has expired.
        await c.del(`${ALIVE_KEY_PREFIX}${host}_${orphanPid}`)

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

    it('destroys an orphan of another host whose liveness key has expired', async () => {
      const c = testClient()
      const tp = `miia-test:bcast-otherhost:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: c, blockMs: 200 })
      await t.onInit?.()

      try {
        const base = `${tp}__Service_run`
        const otherHostGroup = `${base}__other-${randomUUID().slice(0, 8)}_999`
        const currentGroup = `${base}__${hostname()}_${process.pid}`
        await c.xgroup('CREATE', tp, otherHostGroup, '$', 'MKSTREAM')

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group: currentGroup, broadcast: true })

        const after = await listGroupNames(c, tp)
        expect(after).toContain(currentGroup)
        expect(after).not.toContain(otherHostGroup)
      } finally {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    it('keeps the group of another host whose liveness key is alive', async () => {
      const c = testClient()
      const tp = `miia-test:bcast-otherhost-live:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: c, blockMs: 200 })
      await t.onInit?.()

      const owner = `other-${randomUUID().slice(0, 8)}_999`
      try {
        const base = `${tp}__Service_run`
        const otherHostGroup = `${base}__${owner}`
        const currentGroup = `${base}__${hostname()}_${process.pid}`
        await c.xgroup('CREATE', tp, otherHostGroup, '$', 'MKSTREAM')
        await c.set(`${ALIVE_KEY_PREFIX}${owner}`, '1', 'PX', 30_000)

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group: currentGroup, broadcast: true })

        const after = await listGroupNames(c, tp)
        expect(after).toContain(currentGroup)
        expect(after).toContain(otherHostGroup)
      } finally {
        await t.onDestroy?.()
        const cleanup = testClient()
        await cleanup.del(`${ALIVE_KEY_PREFIX}${owner}`)
        await drainKeys(cleanup, tp)
      }
    })

    it('keeps a live sibling process on the same host', async () => {
      // PM2 cluster, several workers per container: same hostname, other pid, fresh key.
      const c = testClient()
      const tp = `miia-test:bcast-sibling:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: c, blockMs: 200 })
      await t.onInit?.()

      const owner = `${hostname()}_${process.pid + 99999}`
      try {
        const base = `${tp}__Service_run`
        const siblingGroup = `${base}__${owner}`
        const currentGroup = `${base}__${hostname()}_${process.pid}`
        await c.xgroup('CREATE', tp, siblingGroup, '$', 'MKSTREAM')
        await c.set(`${ALIVE_KEY_PREFIX}${owner}`, '1', 'PX', 30_000)

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group: currentGroup, broadcast: true })

        expect(await listGroupNames(c, tp)).toContain(siblingGroup)
      } finally {
        await t.onDestroy?.()
        const cleanup = testClient()
        await cleanup.del(`${ALIVE_KEY_PREFIX}${owner}`)
        await drainKeys(cleanup, tp)
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

    describe('liveness', () => {
      const ownKey = `${ALIVE_KEY_PREFIX}${hostname()}_${process.pid}`
      const opened: Array<{ t: RedisStreamsTransport; tp: string; keys: string[] }> = []

      afterEach(async () => {
        for (const { t, tp, keys } of opened.splice(0)) {
          await t.onDestroy?.()
          const cleanup = testClient()
          if (keys.length > 0) await cleanup.del(...keys)
          await drainKeys(cleanup, tp)
        }
      })

      interface Internals {
        aliveRefreshMs: number
        aliveRecheckMs: number
        aliveTimer?: ReturnType<typeof setInterval>
      }

      /** Keys listed in `keys` are deleted after the test. */
      async function setup(keys: string[] = []): Promise<{
        c: Redis
        t: RedisStreamsTransport
        internals: Internals
        logs: CapturedLogs
        tp: string
        group: string
      }> {
        const c = testClient()
        const tp = `miia-test:bcast-alive:${randomUUID()}`
        const t = new RedisStreamsTransport({ client: c, blockMs: 200, retryIntervalMs: NO_HOUSEKEEPING })
        const logs = captureLogs(t)
        await t.onInit?.()
        opened.push({ t, tp, keys })
        const group = `${tp}__Service_run__${hostname()}_${process.pid}`
        return { c, t, internals: t as unknown as Internals, logs, tp, group }
      }

      /** Records the commands a client is asked to run, then runs them - or answers with `fail` when it returns one. */
      function spy(c: Redis, command: string, fail?: (args: unknown[]) => Error | undefined): unknown[][] {
        const calls: unknown[][] = []
        const raw = c as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
        const original = raw[command]!.bind(c)
        raw[command] = (...args) => {
          calls.push(args)
          const err = fail?.(args)
          return err ? Promise.reject(err) : original(...args)
        }
        return calls
      }

      const noperm = (args: unknown[]) =>
        String(args[0]).startsWith(ALIVE_KEY_PREFIX)
          ? new Error(`NOPERM No permissions to access a key: ${String(args[0])}`)
          : undefined

      async function orphan(c: Redis, tp: string, owner: string): Promise<string> {
        const group = `${tp}__Service_run__${owner}`
        await c.xgroup('CREATE', tp, group, '$', 'MKSTREAM')
        return group
      }

      it('a broadcast subscribe writes the liveness key with its TTL', async () => {
        const { c, t, tp, group } = await setup()
        await c.del(ownKey)

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group, broadcast: true })

        const ttl = await c.pttl(ownKey)
        expect(ttl).toBeGreaterThan(0)
        expect(ttl).toBeLessThanOrEqual(30_000)
      })

      it('work-group subscriptions never touch the liveness key', async () => {
        const { c, t, internals, tp } = await setup()
        const sets = spy(c, 'set')

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'workers' })

        expect(sets.filter(([key]) => String(key).startsWith(ALIVE_KEY_PREFIX))).toHaveLength(0)
        expect(internals.aliveTimer).toBeUndefined()
      })

      it('refreshes the liveness key on its cadence', async () => {
        const { c, t, internals, tp, group } = await setup()
        internals.aliveRefreshMs = 100

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group, broadcast: true })
        await c.del(ownKey)

        await waitFor(async () => (await c.exists(ownKey)) === 1, 'the liveness key to be written again')
      })

      it('a NOPERM on the liveness key turns liveness off with one warning and the subscribe still works', async () => {
        const { c, t, internals, logs, tp, group } = await setup()
        internals.aliveRefreshMs = 50
        const sets = spy(c, 'set', noperm)

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group, broadcast: true })
        await t.subscribe(tp, async () => ({ status: 'ack' }), { group: `${group}x`, broadcast: true })
        await wait(250)

        expect(sets).toHaveLength(1)
        expect(internals.aliveTimer).toBeUndefined()
        expect(logs.warns.filter((line) => line.includes('broadcast orphan cleanup is off'))).toHaveLength(1)
        expect(await listGroupNames(c, tp)).toContain(group)
      })

      it('with liveness off, orphan cleanup removes nothing and checks no key', async () => {
        const owner = `other-${randomUUID().slice(0, 8)}_999`
        const { c, t, tp, group } = await setup()
        spy(c, 'set', noperm)
        const checks = spy(c, 'exists')
        const orphanGroup = await orphan(c, tp, owner)

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group, broadcast: true })

        expect(await listGroupNames(c, tp)).toContain(orphanGroup)
        expect(checks).toHaveLength(0)
      })

      it('a liveness check that fails keeps the group it was checking', async () => {
        const owner = `other-${randomUUID().slice(0, 8)}_999`
        const { c, t, logs, tp, group } = await setup()
        const orphanGroup = await orphan(c, tp, owner)
        spy(c, 'exists', () => new Error('Connection is closed.'))

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group, broadcast: true })

        expect(await listGroupNames(c, tp)).toContain(orphanGroup)
        expect(logs.warns.filter((line) => line.startsWith('liveness check failed'))).toHaveLength(1)
      })

      it('removes an orphan whose key outlived the first cleanup on the delayed re-check', async () => {
        // A predecessor that crashed just before this process started: its key is still alive at subscribe.
        const owner = `other-${randomUUID().slice(0, 8)}_999`
        const ownerKey = `${ALIVE_KEY_PREFIX}${owner}`
        const { c, t, internals, logs, tp, group } = await setup([ownerKey])
        internals.aliveRecheckMs = 400
        const orphanGroup = await orphan(c, tp, owner)
        await c.set(ownerKey, '1', 'PX', 300)

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group, broadcast: true })
        expect(await listGroupNames(c, tp)).toContain(orphanGroup)

        await waitFor(async () => !(await listGroupNames(c, tp)).includes(orphanGroup), 'the re-check to remove it')
        expect(logs.logs.filter((line) => line.startsWith('Cleaned up orphaned broadcast group'))).toHaveLength(1)
      })

      it('leaves alone the broadcast groups of sibling handlers whose method name extends ours', async () => {
        const { c, t, tp, group } = await setup()
        const base = `${tp}__Service_run`
        // `run_` and `run__v2` on host `h`, pid 1 - neither has a key, so a match would destroy them.
        const underscored = await orphan(c, tp, '_h_1')
        const versioned = `${base}__v2__h_1`
        await c.xgroup('CREATE', tp, versioned, '$', 'MKSTREAM')

        await t.subscribe(tp, async () => ({ status: 'ack' }), { group, broadcast: true })

        const after = await listGroupNames(c, tp)
        expect(after).toContain(underscored)
        expect(after).toContain(versioned)
      })
    })
  })

  describe('initial position', () => {
    // Every test owns its transport and a fresh topic: a group's start position is decided once, by whoever creates it.
    const opened: Array<{ t: RedisStreamsTransport; tp: string }> = []

    afterEach(async () => {
      for (const { t, tp } of opened.splice(0)) {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    async function setup(): Promise<{ c: Redis; t: RedisStreamsTransport; logs: CapturedLogs; tp: string }> {
      const c = testClient()
      const tp = `miia-test:initpos:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: c, blockMs: 200, retryIntervalMs: NO_HOUSEKEEPING })
      const logs = captureLogs(t)
      await t.onInit?.()
      opened.push({ t, tp })
      return { c, t, logs, tp }
    }

    function collect(received: string[]): (e: MessageEnvelope) => Promise<HandlerResult> {
      return async (e) => {
        received.push((e.payload as { n: string }).n)
        return { status: 'ack' }
      }
    }

    function created(logs: CapturedLogs): string[] {
      return logs.logs.filter((line) => line.startsWith('Created consumer group'))
    }

    async function redisNowMs(c: Redis): Promise<number> {
      const [seconds, micros] = await c.time()
      return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000)
    }

    async function groupInfos(c: Redis, tp: string): Promise<Array<Record<string, unknown>>> {
      let rows: unknown[][]
      try {
        rows = (await (c as unknown as { xinfo: (...args: unknown[]) => Promise<unknown> }).xinfo(
          'GROUPS',
          tp,
        )) as unknown[][]
      } catch (err) {
        if (String(err).includes('no such key')) return []
        throw err
      }
      return rows.map((row) => {
        const info: Record<string, unknown> = {}
        for (let i = 0; i < row.length; i += 2) info[String(row[i])] = row[i + 1]
        return info
      })
    }

    it("'latest' (the default) skips entries published before the group existed", async () => {
      const { t, logs, tp } = await setup()
      const received: string[] = []

      await t.publish(envelope(tp, { n: 'before' }))
      await t.subscribe(tp, collect(received), { group: 'g' })
      await t.publish(envelope(tp, { n: 'after' }))

      // Entries are read in id order, so by the time `after` lands `before` would already have.
      await waitFor(() => received.includes('after'), 'the entry published after subscribe')
      expect(received).toEqual(['after'])
      expect(created(logs)).toHaveLength(1)
      expect(created(logs)[0]).toMatch(/^Created consumer group .+ at \$$/)
    })

    it("'earliest' delivers everything the stream retains", async () => {
      const { c, t, logs, tp } = await setup()
      const received: string[] = []

      await c.xadd(tp, '1-1', 'data', JSON.stringify(envelope(tp, { n: 'ancient' })))
      await t.subscribe(tp, collect(received), { group: 'g', initialPosition: 'earliest' })

      await waitFor(() => received.includes('ancient'), 'the entry with the oldest possible id')
      expect(created(logs)[0]).toMatch(/ at 0$/)
    })

    it('{ since } delivers the window and skips what is older, measured on the Redis clock', async () => {
      const { c, t, logs, tp } = await setup()
      const received: string[] = []
      const now = await redisNowMs(c)

      await c.xadd(tp, `${now - 120_000}-1`, 'data', JSON.stringify(envelope(tp, { n: 'old' })))
      await t.publish(envelope(tp, { n: 'recent' }))
      await t.subscribe(tp, collect(received), { group: 'g', initialPosition: { since: 60_000 } })

      await waitFor(() => received.includes('recent'), 'the entry inside the window')
      expect(received).toEqual(['recent'])
      const line = created(logs)[0]
      expect(line).toMatch(/ at \d+-0$/)
      const cutoff = Number(/ at (\d+)-0$/.exec(line!)![1])
      expect(Math.abs(cutoff - (now - 60_000))).toBeLessThan(5000)
    })

    it("a broadcast group starts at '$' whatever position it is passed", async () => {
      const { t, logs, tp } = await setup()
      const received: string[] = []

      await t.publish(envelope(tp, { n: 'before' }))
      await t.subscribe(tp, collect(received), { group: 'bcast', broadcast: true, initialPosition: 'earliest' })
      await t.publish(envelope(tp, { n: 'after' }))

      await waitFor(() => received.includes('after'), 'the entry published after subscribe')
      expect(received).toEqual(['after'])
      expect(created(logs)).toHaveLength(0)
    })

    it('an existing group is never moved', async () => {
      const { c, t, logs, tp } = await setup()
      const received: string[] = []

      const idA = await c.xadd(tp, '*', 'data', JSON.stringify(envelope(tp, { n: 'A' })))
      await c.xgroup('CREATE', tp, 'g', '$', 'MKSTREAM')
      await t.subscribe(tp, collect(received), { group: 'g', initialPosition: 'earliest' })

      // Read before B exists: once B is delivered, last-delivered-id moves past A and proves nothing.
      const [info] = await groupInfos(c, tp)
      expect(info?.['last-delivered-id']).toBe(idA)

      await t.publish(envelope(tp, { n: 'B' }))
      await waitFor(() => received.includes('B'), 'the entry published after subscribe')
      expect(received).toEqual(['B'])
      expect(created(logs)).toHaveLength(0)
    })

    it('a denied TIME falls back to the process clock and warns once', async () => {
      const { c, t, logs, tp } = await setup()
      ;(c as unknown as { time: () => Promise<unknown> }).time = () =>
        Promise.reject(new Error("NOPERM User limited has no permissions to run the 'time' command"))
      const first: string[] = []
      const second: string[] = []

      await t.publish(envelope(tp, { n: 'recent' }))
      await t.subscribe(tp, collect(first), { group: 'g1', initialPosition: { since: 60_000 } })
      await t.subscribe(tp, collect(second), { group: 'g2', initialPosition: { since: 60_000 } })

      await waitFor(() => first.includes('recent') && second.includes('recent'), 'both groups to get the entry')
      expect(logs.warns.filter((line) => line.startsWith('TIME rejected'))).toHaveLength(1)
    })

    it('any other TIME failure fails the subscribe', async () => {
      const { c, t, tp } = await setup()
      ;(c as unknown as { time: () => Promise<unknown> }).time = () =>
        Promise.reject(new Error('Connection is closed.'))

      await expect(
        t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g', initialPosition: { since: 1000 } }),
      ).rejects.toThrow(/Connection is closed/)
      expect(await groupInfos(c, tp)).toEqual([])
    })

    it('a direct caller passing an invalid window is rejected before any group is created', async () => {
      const { c, t, tp } = await setup()

      for (const since of [Number.NaN, -1000]) {
        await expect(
          t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g', initialPosition: { since } }),
        ).rejects.toThrow(/Invalid initialPosition/)
      }
      expect(await groupInfos(c, tp)).toEqual([])
    })
  })

  describe('NOGROUP recovery', () => {
    // A recovering lane backs off one `CONSUMER_ERROR_BACKOFF_MS` (1s) before it reads again, hence the longer waits.
    const RECOVERY_MS = 4000
    const opened: Array<{ t: RedisStreamsTransport; tp: string }> = []

    afterEach(async () => {
      for (const { t, tp } of opened.splice(0)) {
        await t.onDestroy?.()
        await drainKeys(testClient(), tp)
      }
    })

    async function setup(
      blockMs = 200,
    ): Promise<{ c: Redis; t: RedisStreamsTransport; logs: CapturedLogs; tp: string }> {
      const c = testClient()
      const tp = `miia-test:nogroup:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: c, blockMs, retryIntervalMs: NO_HOUSEKEEPING })
      const logs = captureLogs(t)
      await t.onInit?.()
      opened.push({ t, tp })
      return { c, t, logs, tp }
    }

    function collect(received: string[]): (e: MessageEnvelope) => Promise<HandlerResult> {
      return async (e) => {
        received.push((e.payload as { n: string }).n)
        return { status: 'ack' }
      }
    }

    function created(logs: CapturedLogs): string[] {
      return logs.logs.filter((line) => line.startsWith('Created consumer group'))
    }

    async function add(c: Redis, tp: string, n: string): Promise<string> {
      return (await c.xadd(tp, '*', 'data', JSON.stringify(envelope(tp, { n }))))!
    }

    async function groupNames(c: Redis, tp: string): Promise<string[]> {
      const rows = (await c.xinfo('GROUPS', tp)) as unknown[][]
      return rows.map((row) => String(row[row.indexOf('name') + 1]))
    }

    it('a stream deleted under a live subscriber comes back without replaying what was read', async () => {
      // A long BLOCK, so only a read woken by the DEL itself reports the loss within `waitFor`'s timeout.
      const { c, t, logs, tp } = await setup(30_000)
      const received: string[] = []
      await t.subscribe(tp, collect(received), { group: 'g' })
      await add(c, tp, 'A')
      await waitFor(() => received.includes('A'), 'A')
      // A recreated stream numbers its first entry `<ms>-0` and the group resumes after A, so B must not share A's
      // millisecond - here they can be one round trip apart.
      await wait(10)

      await c.del(tp)
      // The blocked read wakes on the DEL itself, before anything is added to the key again.
      await waitFor(() => logs.errors.some((line) => line.endsWith('is gone, recreating it')), 'the recovery line')
      await add(c, tp, 'B')

      await waitFor(() => received.includes('B'), 'B after the stream was deleted', RECOVERY_MS)
      expect(received).toEqual(['A', 'B'])
    }, 10_000)

    it('a group destroyed on an intact stream resumes after the last entry this process read', async () => {
      const { c, t, logs, tp } = await setup()
      const received: string[] = []
      await t.subscribe(tp, collect(received), { group: 'g' })
      const idA = await add(c, tp, 'A')
      await waitFor(() => received.includes('A'), 'A')

      await c.xgroup('DESTROY', tp, 'g')
      await waitFor(() => created(logs).length === 2, 'the group to be recreated')
      expect(created(logs)[1]).toBe(`Created consumer group g on ${tp} at ${idA}`)
      await add(c, tp, 'C')

      await waitFor(() => received.includes('C'), 'C after the group was recreated', RECOVERY_MS)
      expect(received).toEqual(['A', 'C'])
    }, 10_000)

    it('a group destroyed before anything was read comes back where it stood at subscribe', async () => {
      const { c, t, logs, tp } = await setup()
      const received: string[] = []
      await t.subscribe(tp, collect(received), { group: 'g' })

      await c.xgroup('DESTROY', tp, 'g')
      await waitFor(() => created(logs).length === 2, 'the group to be recreated')
      // Created at `$` on an empty stream, the group stood at 0-0: the seeded position, not `initialPosition` again.
      expect(created(logs)[1]).toEndWith(' at 0-0')
      await add(c, tp, 'X')

      await waitFor(() => received.includes('X'), 'X after the group was recreated', RECOVERY_MS)
      expect(received).toEqual(['X'])
    }, 10_000)

    it('a lane that recovers does not start below an entry another lane is still handling', async () => {
      const { c, t, logs, tp } = await setup()
      const handled: string[] = []
      let release!: () => void
      const gate = new Promise<void>((r) => {
        release = r
      })
      await t.subscribe(
        tp,
        async (e) => {
          const n = (e.payload as { n: string }).n
          handled.push(n)
          if (n === 'A') await gate
          return { status: 'ack' }
        },
        { group: 'g', mode: 'sliding', concurrency: 2, initialPosition: 'earliest' },
      )
      const idA = await add(c, tp, 'A')
      await waitFor(() => handled.includes('A'), 'A to go in flight')

      await c.xgroup('DESTROY', tp, 'g')
      await waitFor(() => created(logs).length === 2, 'the idle lane to recreate the group')
      expect(created(logs)[1]).toEndWith(` at ${idA}`)
      await add(c, tp, 'C')
      await waitFor(() => handled.includes('C'), 'C on the recovered lane', RECOVERY_MS)

      release()
      await wait(300)
      expect(handled).toEqual(['A', 'C'])
    }, 10_000)

    it('a broadcast group destroyed under its subscriber comes back without replaying what was read', async () => {
      const { c, t, tp } = await setup()
      const group = `${tp}__Cache_flush__${hostname()}_${process.pid}`
      const received: string[] = []
      await t.subscribe(tp, collect(received), { group, broadcast: true })
      await add(c, tp, 'A')
      await waitFor(() => received.includes('A'), 'A')

      await c.xgroup('DESTROY', tp, group)
      await add(c, tp, 'B')

      await waitFor(() => received.includes('B'), 'B after the group was destroyed', RECOVERY_MS)
      expect(received).toEqual(['A', 'B'])
      expect(await groupNames(c, tp)).toContain(group)
    }, 10_000)

    it('a lane that never sees its group backs off instead of spinning', async () => {
      const { c, t, logs, tp } = await setup()
      // Lanes on another database: every read answers NOGROUP, every recreation on the publisher answers BUSYGROUP.
      const duplicate = c.duplicate.bind(c)
      c.duplicate = ((override) => duplicate({ ...override, db: (c.options.db ?? 0) + 1 })) as Redis['duplicate']
      const raw = c as unknown as { xgroup: (...args: unknown[]) => Promise<unknown> }
      const xgroup = raw.xgroup.bind(c)
      let creates = 0
      raw.xgroup = (...args) => {
        if (args[0] === 'CREATE' && args[1] === tp) creates++
        return xgroup(...args)
      }

      await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g' })
      await wait(1500)

      expect(creates).toBeGreaterThanOrEqual(2)
      expect(creates).toBeLessThanOrEqual(4)
      expect(logs.errors.filter((line) => line.includes(`on ${tp}`)).length).toBeLessThanOrEqual(2)
      const started = Date.now()
      await t.onDestroy?.()
      expect(Date.now() - started).toBeLessThan(2000)
    }, 10_000)

    it('the last unsubscribe on a pair forgets its known position', async () => {
      const { t, tp } = await setup()
      const lastRead = (t as unknown as { lastRead: Map<string, Map<string, string>> }).lastRead
      const first = await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g' })
      const second = await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g' })
      expect(lastRead.get(tp)?.has('g')).toBe(true)

      await first.unsubscribe()
      expect(lastRead.get(tp)?.has('g')).toBe(true)
      await second.unsubscribe()
      expect(lastRead.has(tp)).toBe(false)
    })
  })

  describe('malformed entries', () => {
    it('acks and skips entries that are not message envelopes, then keeps consuming', async () => {
      const probe = testClient()
      const tp = `miia-test:malformed:${randomUUID()}`
      const t = new RedisStreamsTransport({ client: testClient(), blockMs: 200, retryIntervalMs: NO_HOUSEKEEPING })
      const logs = captureLogs(t)
      await t.onInit?.()

      const received: MessageEnvelope[] = []
      try {
        await t.subscribe(
          tp,
          async (e) => {
            received.push(e)
            return { status: 'ack' }
          },
          { group: 'g' },
        )

        const malformed = [
          '{}',
          'null',
          '42',
          '"s"',
          '[]',
          '{"id":"x"}',
          '{"id":1,"meta":{}}',
          '{"id":"x","meta":null}',
          '{',
        ]
        const bad: string[] = []
        for (const data of malformed) bad.push((await probe.xadd(tp, '*', 'data', data))!)
        bad.push((await probe.xadd(tp, '*', 'other', 'v'))!)
        const valid = envelope(tp, { n: 1 })
        await t.publish(valid)

        await waitFor(() => received.length > 0, 'the valid entry behind the malformed ones')
        await waitFor(async () => Number((await probe.xpending(tp, 'g'))[0]) === 0, 'every entry to be acked')
        expect(received.map((e) => e.id)).toEqual([valid.id])
        for (const id of bad) expect(logs.errors).toContain(`Failed to parse stream entry ${id}`)
      } finally {
        await t.onDestroy?.()
        await drainKeys(probe, tp)
      }
    })
  })

  describe('server version', () => {
    const opened: RedisStreamsTransport[] = []

    afterEach(async () => {
      for (const t of opened.splice(0)) await t.onDestroy?.()
    })

    async function init(hello?: () => Promise<unknown>): Promise<CapturedLogs> {
      const c = testClient()
      if (hello) {
        // ioredis sends HELLO itself while connecting, so the stub goes in once the handshake is done.
        await c.ping()
        const raw = c as unknown as { call: (...args: unknown[]) => Promise<unknown> }
        const call = raw.call.bind(c)
        raw.call = (...args) => (String(args[0]).toUpperCase() === 'HELLO' ? hello() : call(...args))
      }
      const t = new RedisStreamsTransport({ client: c, retryIntervalMs: NO_HOUSEKEEPING })
      opened.push(t)
      const logs = captureLogs(t)
      await t.onInit?.()
      return logs
    }

    it('warns once on a server older than 7.2 and still starts', async () => {
      const logs = await init(async () => ['server', 'redis', 'version', '6.2.0', 'proto', 3])

      expect(logs.warns).toHaveLength(1)
      expect(logs.warns[0]).toContain('6.2.0')
      expect(logs.warns[0]).toContain('7.2')
    })

    it('warns once when HELLO is denied and still starts', async () => {
      const logs = await init(() =>
        Promise.reject(new Error("NOPERM User limited has no permissions to run the 'hello' command")),
      )

      expect(logs.warns).toHaveLength(1)
      expect(logs.warns[0]).toStartWith('Could not check the Redis version')
    })

    it('fails to start on any other HELLO error', async () => {
      await expect(init(() => Promise.reject(new Error('Connection is closed.')))).rejects.toThrow(
        'Connection is closed.',
      )
    })

    it('says nothing on a supported server', async () => {
      const logs = await init()

      expect(logs.warns).toEqual([])
    })
  })

  describe('client protocol', () => {
    it('rejects a client created with replyMapping resp3', () => {
      const resp3 = new Redis(REDIS_URL!, { replyMapping: 'resp3', lazyConnect: true })
      try {
        expect(() => new RedisStreamsTransport({ client: resp3 })).toThrow(/replyMapping: 'resp3'/)
      } finally {
        resp3.disconnect()
      }
    })

    it('works over a RESP2 connection', async () => {
      const c = testClient({ protocol: 2 })
      const tp = `miia-test:resp2:${randomUUID()}`
      const bcastTp = `miia-test:resp2-bcast:${randomUUID()}`
      const t = new RedisStreamsTransport({
        client: c,
        retry: { backoffMs: 50, maxAttempts: 3 },
        retryIntervalMs: 50,
        minIdleMs: 300,
        blockMs: 200,
      })
      await t.onInit?.()

      try {
        // `HELLO` without a version reports the connection's protocol.
        const hello = (await c.call('HELLO')) as unknown[]
        expect(hello[hello.indexOf('proto') + 1]).toBe(2)

        const attempts: number[] = []
        await t.subscribe(
          tp,
          async (e): Promise<HandlerResult> => {
            attempts.push(e.meta.attempt)
            if (e.meta.attempt < 2) return { status: 'nack', error: new Error('transient') }
            return { status: 'ack' }
          },
          { group: 'g' },
        )

        // An orphan for the broadcast subscribe to find: the scan only sees it if XINFO GROUPS parses over RESP2.
        const base = `${bcastTp}__Service_run`
        const orphan = `${base}__other-${randomUUID().slice(0, 8)}_999`
        await c.xgroup('CREATE', bcastTp, orphan, '$', 'MKSTREAM')
        const broadcast: MessageEnvelope[] = []
        await t.subscribe(
          bcastTp,
          async (e) => {
            broadcast.push(e)
            return { status: 'ack' }
          },
          { group: `${base}__${hostname()}_${process.pid}`, broadcast: true },
        )
        const groups = (await c.xinfo('GROUPS', bcastTp)) as unknown[][]
        expect(groups.map((row) => String(row[row.indexOf('name') + 1]))).not.toContain(orphan)
        await wait(50)

        await t.publish(envelope(tp))
        await t.publish(envelope(bcastTp, { n: 1 }))
        await waitFor(() => attempts.length === 2, 'two attempts')
        await waitFor(() => broadcast.length === 1, 'the broadcast message')
        expect(attempts).toEqual([1, 2])
        expect(broadcast[0]?.payload).toEqual({ n: 1 })
      } finally {
        await t.onDestroy?.()
        await drainKeys(c, tp)
        await drainKeys(c, bcastTp)
      }
    })
  })

  describe('connection errors', () => {
    it('logs a refused connection through the logger instead of an unhandled ioredis error', async () => {
      const unhandled = spyOn(console, 'error')
      const t = new RedisStreamsTransport({
        url: `redis://localhost:${await closedPort()}`,
        retryIntervalMs: NO_HOUSEKEEPING,
      })
      const logs = captureLogs(t)
      try {
        await expect(t.onInit()).rejects.toThrow()
        await wait(300)

        const line = logs.errors.indexOf('Redis connection error')
        expect(line).toBeGreaterThanOrEqual(0)
        expect(logs.errorDetails[line]).toContain('ECONNREFUSED')
        expect(unhandled.mock.calls.filter(([first]) => String(first).includes('Unhandled error event'))).toEqual([])
      } finally {
        await t.onDestroy()
        unhandled.mockRestore()
      }
      expect(logs.logs.filter((line) => line.includes('recovered'))).toEqual([])
    })

    it('adds no error listener to a client you pass, and one to each lane', async () => {
      const c = testClient()
      const tp = `miia-test:conn-listeners:${randomUUID()}`
      const before = c.listenerCount('error')
      const t = new RedisStreamsTransport({ client: c, blockMs: 200, retryIntervalMs: NO_HOUSEKEEPING })
      try {
        await t.onInit()
        await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'g', mode: 'sliding', concurrency: 2 })

        expect(c.listenerCount('error')).toBe(before)
        const lanes = (t as unknown as { subs: Array<{ lanes: Array<{ client: Redis }> }> }).subs[0]!.lanes
        expect(lanes.map((lane) => lane.client.listenerCount('error'))).toEqual([1, 1])
      } finally {
        await t.onDestroy()
        await drainKeys(testClient(), tp)
      }
    })
  })
})
