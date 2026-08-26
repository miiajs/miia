import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { LoggerService } from '@miiajs/core'
import type { MessageEnvelope, HandlerResult } from '@miiajs/messaging'
import { Redis } from 'ioredis'
import { FAILURE_LOG_BURST } from '../src/constants.js'
import { RedisStreamsTransport, type RedisStreamsTransportOptions } from '../src/redis-streams-transport.js'

const REDIS_URL = process.env.REDIS_TEST_URL
const d = REDIS_URL ? describe : describe.skip

/**
 * Retry horizon used throughout: the idle threshold at which a pending entry counts as abandoned, and so the
 * crash-detection latency. 300ms is deliberate - the gap between `XREADGROUP` returning and the transport registering
 * the entry as in-flight measures 0-1ms on a local Redis, so nothing here rides on a 50ms margin.
 */
const HORIZON_MS = 300

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

/**
 * Poll until `check` holds. Everything under test is driven by a Redis round trip on a timer, so the arrival time is
 * a range rather than a number - polling keeps the assertion about behaviour and the failure message about what never
 * happened. The timeout sits below bun's per-test default so a failure reports this message and not `test timed out`.
 */
async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await wait(10)
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)
}

/** `XPENDING` extended-form row: id, consumer, idle ms, delivery count. */
type PendingEntry = [string, string, number, number]

// ioredis 5 types cover neither `XPENDING`'s extended form nor variadic ids in front of `JUSTID`.
interface RawRedis {
  xpending(...args: unknown[]): Promise<unknown>
  xclaim(...args: unknown[]): Promise<unknown>
  xreadgroup(...args: unknown[]): Promise<unknown>
}

async function pending(client: Redis, topic: string, group: string): Promise<PendingEntry[]> {
  const rows = (await (client as unknown as RawRedis).xpending(topic, group, 'IDLE', 0, '-', '+', 50)) as
    | PendingEntry[]
    | null
  return rows ?? []
}

async function dlqEnvelopes(client: Redis, topic: string): Promise<MessageEnvelope[]> {
  const entries = await client.xrange(`${topic}.dlq`, '-', '+')
  return entries.map(([, fields]) => JSON.parse(fields[fields.indexOf('data') + 1]!) as MessageEnvelope)
}

/** Ids of the entries a group has never seen, taken by a consumer that then never acks - a crashed process. */
async function takeAsDeadConsumer(client: Redis, topic: string, group: string, count: number): Promise<string[]> {
  const read = (await (client as unknown as RawRedis).xreadgroup(
    'GROUP',
    group,
    `dead-${randomUUID().slice(0, 8)}`,
    'COUNT',
    count,
    'STREAMS',
    topic,
    '>',
  )) as Array<[string, Array<[string, string[]]>]> | null
  return (read?.[0]?.[1] ?? []).map(([id]) => id)
}

interface CapturedLogs {
  errors: string[]
  /** Second argument of each `error()` call, by the same index: the cause a failure line carries. */
  errorDetails: string[]
  warns: string[]
  logs: string[]
}

/** `dlq: false` drops the message; the log line is the only trace it leaves, so the test has to read the logger. */
function captureLogs(transport: RedisStreamsTransport): CapturedLogs {
  const captured: CapturedLogs = { errors: [], errorDetails: [], warns: [], logs: [] }
  const recorder: LoggerService = {
    log: (message) => {
      captured.logs.push(message)
    },
    warn: (message) => {
      captured.warns.push(message)
    },
    error: (message, trace) => {
      captured.errors.push(message)
      captured.errorDetails.push(trace ?? '')
    },
    debug: () => {},
  }
  ;(transport as unknown as { logger: LoggerService }).logger = recorder
  return captured
}

/** One failure line of a housekeeping channel: the message carries the count, the detail carries the cause. */
interface SweepLine {
  message: string
  detail: string
}

/** The failure lines of `topic`'s sweep, message and detail paired back up by position. */
function sweepLines(logs: CapturedLogs, topic: string): SweepLine[] {
  return logs.errors
    .map((message, i) => ({ message, detail: logs.errorDetails[i] ?? '' }))
    .filter((line) => line.message.includes(`retry sweep failed for ${topic}/`))
}

interface SweepHarness {
  transport: RedisStreamsTransport
  logs: CapturedLogs
  topic: string
  /** Make every following sweep round trip reject with a fresh `cause()`. */
  fail(cause: () => Error): void
  /** Hand the real command back, so the next sweep succeeds. */
  heal(): void
  close(): Promise<void>
}

/**
 * A transport ticking fast enough to make log suppression observable, with the sweep's first round trip under the
 * test's control. Rejecting one command beats tearing the connection down: the failure lands on exactly one channel,
 * on every tick, with no reconnect timing to make the line count flaky.
 */
async function sweepHarness(): Promise<SweepHarness> {
  const probe = new Redis(REDIS_URL!)
  const busClient = new Redis(REDIS_URL!)
  const tp = `miia-test:retry-log:${randomUUID()}`
  const transport = new RedisStreamsTransport({
    client: busClient,
    retry: { backoffMs: 50, maxAttempts: 3 },
    retryIntervalMs: 20,
    minIdleMs: HORIZON_MS,
    blockMs: 100,
  })
  const logs = captureLogs(transport)
  await transport.onInit?.()

  const raw = busClient as unknown as { xpending: (...args: unknown[]) => Promise<unknown> }
  const xpending = raw.xpending.bind(raw)
  const heal = () => {
    raw.xpending = xpending
  }

  return {
    transport,
    logs,
    topic: tp,
    fail: (cause) => {
      raw.xpending = () => Promise.reject(cause())
    },
    heal,
    close: async () => {
      // Before the drain, so `onDestroy()` gets a working client whatever the test left behind.
      heal()
      await transport.onDestroy?.()
      try {
        await drainKeys(probe, tp)
      } finally {
        await Promise.all([probe.quit(), busClient.quit()])
      }
    },
  }
}

d('RedisStreamsTransport retry', () => {
  let client: Redis
  let transport: RedisStreamsTransport
  let topic: string

  beforeEach(async () => {
    client = new Redis(REDIS_URL!)
    topic = `miia-test:${randomUUID()}`
    transport = new RedisStreamsTransport({
      client,
      retry: { backoffMs: 50, maxAttempts: 3 },
      retryIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 200,
    })
    await transport.onInit?.()
  })

  afterEach(async () => {
    await transport.onDestroy?.()
    const cleanup = new Redis(REDIS_URL!)
    try {
      await drainKeys(cleanup, topic)
    } finally {
      await cleanup.quit()
    }
  })

  it('retries nacked messages with exponential backoff', async () => {
    const attempts: number[] = []
    await transport.subscribe(
      topic,
      async (e): Promise<HandlerResult> => {
        attempts.push(e.meta.attempt)
        if (e.meta.attempt < 3) {
          return { status: 'nack', error: new Error('transient') }
        }
        return { status: 'ack' }
      },
      { group: 'g' },
    )
    await wait(50)

    await transport.publish(envelope(topic))
    await waitFor(() => attempts.length === 3, 'three attempts')

    expect(attempts).toEqual([1, 2, 3])
  })

  it('moves message to <topic>.dlq after maxAttempts', async () => {
    const dlqReceived: MessageEnvelope[] = []

    await transport.subscribe(
      topic,
      async (): Promise<HandlerResult> => ({ status: 'nack', error: new Error('permanent fail') }),
      { group: 'g' },
    )
    await transport.subscribe(
      `${topic}.dlq`,
      async (e) => {
        dlqReceived.push(e)
        return { status: 'ack' }
      },
      { group: 'dlq' },
    )
    await wait(50)

    await transport.publish(envelope(topic, { id: 42 }))
    await waitFor(() => dlqReceived.length === 1, 'a DLQ delivery')

    expect(dlqReceived).toHaveLength(1)
    expect(dlqReceived[0]?.topic).toBe(`${topic}.dlq`)
    expect(dlqReceived[0]?.payload).toEqual({ id: 42 })
    expect(dlqReceived[0]?.meta.lastError).toBe('permanent fail')
    // The attempt that failed, not the `.dlq` stream's own delivery count of 1.
    expect(dlqReceived[0]?.meta.attempt).toBe(3)
  })

  it('leaves no pending entry behind after a successful ack', async () => {
    const received: MessageEnvelope[] = []
    await transport.subscribe(
      topic,
      async (e) => {
        received.push(e)
        return { status: 'ack' }
      },
      { group: 'g' },
    )
    await wait(50)

    await transport.publish(envelope(topic))
    await waitFor(() => received.length === 1, 'the delivery')

    // A pending entry nobody owns is a permanently stuck message, and no handler-level assertion would notice.
    await waitFor(async () => (await pending(client, topic, 'g')).length === 0, 'an empty PEL')
    expect(await pending(client, topic, 'g')).toHaveLength(0)
  })

  it('leaves no pending entry behind after a DLQ move', async () => {
    await transport.subscribe(
      topic,
      async (): Promise<HandlerResult> => ({ status: 'nack', error: new Error('nope') }),
      {
        group: 'g',
      },
    )
    await wait(50)

    await transport.publish(envelope(topic))
    await waitFor(async () => (await dlqEnvelopes(client, topic)).length === 1, 'the DLQ record')

    await waitFor(async () => (await pending(client, topic, 'g')).length === 0, 'an empty PEL')
    expect(await pending(client, topic, 'g')).toHaveLength(0)
  })

  it('consuming <topic>.dlq does not produce <topic>.dlq.dlq', async () => {
    const dlqReceived: MessageEnvelope[] = []
    await transport.subscribe(
      topic,
      async (): Promise<HandlerResult> => ({ status: 'nack', error: new Error('nope') }),
      {
        group: 'g',
      },
    )
    await transport.subscribe(
      `${topic}.dlq`,
      async (e) => {
        dlqReceived.push(e)
        return { status: 'ack' }
      },
      { group: 'dlq' },
    )
    await wait(50)

    await transport.publish(envelope(topic, { n: 1 }))
    await waitFor(() => dlqReceived.length === 1, 'the DLQ delivery')

    // The DLQ record keeps the attempt of the original failure, so reading it can never look like a fresh exhaustion.
    expect(dlqReceived[0]?.meta.attempt).toBe(3)
    await waitFor(async () => (await pending(client, `${topic}.dlq`, 'dlq')).length === 0, 'an empty DLQ PEL')
    await wait(300)

    expect(await client.exists(`${topic}.dlq.dlq`)).toBe(0)
    expect(await client.xlen(`${topic}.dlq`)).toBe(1)
  })

  it('a retry in one consumer group is never redelivered to another group on the same topic', async () => {
    const flaky: number[] = []
    const stable: MessageEnvelope[] = []

    await transport.subscribe(
      topic,
      async (e): Promise<HandlerResult> => {
        flaky.push(e.meta.attempt)
        return { status: 'nack', error: new Error('boom') }
      },
      { group: 'group-a-flaky' },
    )
    await transport.subscribe(
      topic,
      async (e) => {
        stable.push(e)
        return { status: 'ack' }
      },
      { group: 'group-b-stable' },
    )
    await wait(100)

    await transport.publish(envelope(topic, { n: 1 }))
    // Group A reaching the DLQ is the last thing that could fan out: a retry re-published to the main stream would
    // already have been read by group B by the time the final attempt runs.
    await waitFor(async () => (await dlqEnvelopes(client, topic)).length === 1, 'group A to exhaust its budget')
    await wait(200)

    expect(flaky).toEqual([1, 2, 3])
    expect(stable).toHaveLength(1)
    expect(stable[0]?.meta.attempt).toBe(1)
  })

  it('redelivers an entry left pending by a dead consumer', async () => {
    const probe = new Redis(REDIS_URL!)
    const tp = `miia-test:retry-dead:${randomUUID()}`
    const t = new RedisStreamsTransport({
      client: new Redis(REDIS_URL!),
      retry: { backoffMs: 50, maxAttempts: 5 },
      retryIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 200,
    })
    await t.onInit?.()

    try {
      // Group first, so the entry published next is delivered to the dead consumer rather than to our subscriber.
      await probe.xgroup('CREATE', tp, 'g', '$', 'MKSTREAM')
      await t.publish(envelope(tp, { n: 1 }))
      expect(await takeAsDeadConsumer(probe, tp, 'g', 1)).toHaveLength(1)

      const received: MessageEnvelope[] = []
      await t.subscribe(
        tp,
        async (e) => {
          received.push(e)
          return { status: 'ack' }
        },
        { group: 'g' },
      )

      await waitFor(() => received.length > 0, 'the abandoned entry to be redelivered')
      expect(received).toHaveLength(1)
      expect(received[0]?.payload).toEqual({ n: 1 })
      // Redis counted the dead consumer's delivery, so this one is the second.
      expect(received[0]?.meta.attempt).toBe(2)
      await waitFor(async () => (await pending(probe, tp, 'g')).length === 0, 'an empty PEL')
    } finally {
      await t.onDestroy?.()
      try {
        await drainKeys(probe, tp)
      } finally {
        await probe.quit()
      }
    }
  })

  it('advances the attempt sequence across a consumer crash', async () => {
    const probe = new Redis(REDIS_URL!)
    const tp = `miia-test:retry-crash:${randomUUID()}`
    const options: RedisStreamsTransportOptions = {
      retry: { backoffMs: 50, maxAttempts: 4 },
      retryIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 100,
    }
    // A killed process drains nothing, so the crashing side gets no drain budget at all.
    const crashed = new RedisStreamsTransport({ ...options, client: new Redis(REDIS_URL!), drainTimeoutMs: 0 })
    const survivor = new RedisStreamsTransport({ ...options, client: new Redis(REDIS_URL!) })
    await crashed.onInit?.()
    await survivor.onInit?.()

    const before: number[] = []
    const after: number[] = []
    try {
      await crashed.subscribe(
        tp,
        async (e): Promise<HandlerResult> => {
          before.push(e.meta.attempt)
          if (e.meta.attempt === 1) return { status: 'nack', error: new Error('transient') }
          // Attempt 2 never returns: the SIGKILL equivalent, leaving the entry pending with its counter at 2.
          return new Promise<HandlerResult>(() => {})
        },
        { group: 'g' },
      )
      await wait(50)

      await crashed.publish(envelope(tp, { n: 1 }))
      await waitFor(() => before.length === 2, 'two attempts before the crash')
      await crashed.onDestroy?.()

      await survivor.subscribe(
        tp,
        async (e): Promise<HandlerResult> => {
          after.push(e.meta.attempt)
          return { status: 'nack', error: new Error('still failing') }
        },
        { group: 'g' },
      )

      await waitFor(async () => (await dlqEnvelopes(probe, tp)).length === 1, 'the DLQ record')

      expect(before).toEqual([1, 2])
      expect(after).toEqual([3, 4])
      const dead = await dlqEnvelopes(probe, tp)
      expect(dead[0]?.meta.attempt).toBe(4)
      expect(dead[0]?.meta.lastError).toBe('still failing')
    } finally {
      await survivor.onDestroy?.()
      try {
        await drainKeys(probe, tp)
      } finally {
        await probe.quit()
      }
    }
  }, 15_000)

  it('heartbeat keeps a handler that outlives the horizon from being stolen by another transport', async () => {
    const probe = new Redis(REDIS_URL!)
    const tp = `miia-test:retry-heartbeat:${randomUUID()}`
    const options: RedisStreamsTransportOptions = {
      retry: { backoffMs: 50, maxAttempts: 5 },
      retryIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 100,
      drainTimeoutMs: 3000,
    }
    const worker = new RedisStreamsTransport({ ...options, client: new Redis(REDIS_URL!) })
    const sweeper = new RedisStreamsTransport({ ...options, client: new Redis(REDIS_URL!) })
    await worker.onInit?.()
    await sweeper.onInit?.()

    let started = false
    let finished = false
    const stolen: MessageEnvelope[] = []
    try {
      await worker.subscribe(
        tp,
        async () => {
          started = true
          await wait(HORIZON_MS * 5)
          finished = true
          return { status: 'ack' }
        },
        { group: 'g' },
      )
      await wait(50)

      await worker.publish(envelope(tp, { n: 1 }))
      await waitFor(() => started, 'the long handler to start')

      // A second replica on the same group, with no knowledge of the worker's in-flight set.
      await sweeper.subscribe(
        tp,
        async (e) => {
          stolen.push(e)
          return { status: 'ack' }
        },
        { group: 'g' },
      )

      // Two horizons into a five-horizon handler: without renewal the entry would be claimable by now.
      await wait(HORIZON_MS * 2)
      const midFlight = await pending(probe, tp, 'g')
      expect(midFlight).toHaveLength(1)
      expect(midFlight[0]![2]).toBeLessThan(HORIZON_MS)
      // JUSTID renewals must not inflate the counter, or the handler would burn its budget by running slowly.
      expect(midFlight[0]![3]).toBe(1)

      await waitFor(() => finished, 'the long handler to finish')
      await waitFor(async () => (await pending(probe, tp, 'g')).length === 0, 'an empty PEL')
      expect(stolen).toHaveLength(0)
    } finally {
      await worker.onDestroy?.()
      await sweeper.onDestroy?.()
      try {
        await drainKeys(probe, tp)
      } finally {
        await probe.quit()
      }
    }
  }, 15_000)

  it('two transports sweeping one group write exactly one DLQ record per message', async () => {
    const probe = new Redis(REDIS_URL!)
    const tp = `miia-test:retry-gated-dlq:${randomUUID()}`
    const messages = 5
    const options: RedisStreamsTransportOptions = {
      retry: { backoffMs: 50, maxAttempts: 2 },
      retryIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 100,
    }
    const a = new RedisStreamsTransport({ ...options, client: new Redis(REDIS_URL!) })
    const b = new RedisStreamsTransport({ ...options, client: new Redis(REDIS_URL!) })
    await a.onInit?.()
    await b.onInit?.()

    const handled: MessageEnvelope[] = []
    try {
      await probe.xgroup('CREATE', tp, 'g', '$', 'MKSTREAM')
      for (let i = 0; i < messages; i++) await a.publish(envelope(tp, { i }))

      // Burn both deliveries on consumers that never came back, so every entry is abandoned AND out of budget: the
      // next pass on either transport wants to DLQ all five, and only the gate decides who actually does.
      const ids = await takeAsDeadConsumer(probe, tp, 'g', messages)
      expect(ids).toHaveLength(messages)
      await (probe as unknown as RawRedis).xclaim(tp, 'g', 'dead-second', 0, ...ids)

      const record = async (e: MessageEnvelope): Promise<HandlerResult> => {
        handled.push(e)
        return { status: 'ack' }
      }
      await a.subscribe(tp, record, { group: 'g' })
      await b.subscribe(tp, record, { group: 'g' })

      await waitFor(async () => (await dlqEnvelopes(probe, tp)).length >= messages, 'a DLQ record per message')
      // A duplicate from the losing transport would land within one more pass on either side.
      await wait(300)

      expect(await dlqEnvelopes(probe, tp)).toHaveLength(messages)
      // Out of budget before the claim: an exhausted entry is never handed to a handler again.
      expect(handled).toHaveLength(0)
      expect(await pending(probe, tp, 'g')).toHaveLength(0)
    } finally {
      await a.onDestroy?.()
      await b.onDestroy?.()
      try {
        await drainKeys(probe, tp)
      } finally {
        await probe.quit()
      }
    }
  }, 15_000)

  it('a reclaimed handler that never returns does not stall housekeeping for another subscription', async () => {
    const probe = new Redis(REDIS_URL!)
    const stalling = `miia-test:retry-stall:${randomUUID()}`
    const healthy = `miia-test:retry-stall-healthy:${randomUUID()}`
    const t = new RedisStreamsTransport({
      client: new Redis(REDIS_URL!),
      retry: { backoffMs: 50, maxAttempts: 5 },
      retryIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 100,
      // The hung handler outlives the test, so teardown must not spend a drain budget on it.
      drainTimeoutMs: 0,
    })
    await t.onInit?.()

    const delivered: MessageEnvelope[] = []
    try {
      // Two subscriptions, each with an entry abandoned by a dead consumer, so one pass has to reclaim both. The
      // stalling one is subscribed first, so it is also swept first.
      await probe.xgroup('CREATE', stalling, 'ga', '$', 'MKSTREAM')
      await t.publish(envelope(stalling, { n: 1 }))
      expect(await takeAsDeadConsumer(probe, stalling, 'ga', 1)).toHaveLength(1)

      await probe.xgroup('CREATE', healthy, 'gb', '$', 'MKSTREAM')
      await t.publish(envelope(healthy, { n: 2 }))
      expect(await takeAsDeadConsumer(probe, healthy, 'gb', 1)).toHaveLength(1)

      let entered = false
      await t.subscribe(
        stalling,
        async (): Promise<HandlerResult> => {
          entered = true
          return new Promise<HandlerResult>(() => {})
        },
        { group: 'ga', concurrency: 1 },
      )
      await t.subscribe(
        healthy,
        async (e) => {
          delivered.push(e)
          return { status: 'ack' }
        },
        { group: 'gb' },
      )

      await waitFor(() => entered, 'the reclaimed handler that never returns')
      // Housekeeping is single-flight for the whole transport, so an unbounded wait here starves every other pair.
      await waitFor(() => delivered.length === 1, "the other subscription's abandoned entry to be redelivered")
      expect(delivered[0]?.payload).toEqual({ n: 2 })
    } finally {
      await t.onDestroy?.()
      try {
        await drainKeys(probe, stalling)
        await drainKeys(probe, healthy)
      } finally {
        await probe.quit()
      }
    }
  }, 15_000)

  it('drops and logs instead of writing a DLQ record when dlq is false (nack path)', async () => {
    const probe = new Redis(REDIS_URL!)
    const tp = `miia-test:retry-nodlq-nack:${randomUUID()}`
    const t = new RedisStreamsTransport({
      client: new Redis(REDIS_URL!),
      retry: { backoffMs: 50, maxAttempts: 2, dlq: false },
      retryIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 100,
    })
    const logs = captureLogs(t)
    await t.onInit?.()

    const attempts: number[] = []
    try {
      await t.subscribe(
        tp,
        async (e): Promise<HandlerResult> => {
          attempts.push(e.meta.attempt)
          return { status: 'nack', error: new Error('permanent') }
        },
        { group: 'g' },
      )
      await wait(50)

      const env = envelope(tp, { n: 1 })
      await t.publish(env)
      await waitFor(() => attempts.length === 2, 'both attempts')
      await waitFor(async () => (await pending(probe, tp, 'g')).length === 0, 'the entry to be acked away')

      expect(await dlqEnvelopes(probe, tp)).toHaveLength(0)
      expect(await probe.exists(`${tp}.dlq`)).toBe(0)
      expect(logs.errors.some((m) => m.includes(env.id))).toBe(true)
    } finally {
      await t.onDestroy?.()
      try {
        await drainKeys(probe, tp)
      } finally {
        await probe.quit()
      }
    }
  })

  it('drops and logs instead of writing a DLQ record when dlq is false (abandoned path)', async () => {
    const probe = new Redis(REDIS_URL!)
    const tp = `miia-test:retry-nodlq-abandoned:${randomUUID()}`
    const t = new RedisStreamsTransport({
      client: new Redis(REDIS_URL!),
      retry: { backoffMs: 50, maxAttempts: 1, dlq: false },
      retryIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 100,
    })
    const logs = captureLogs(t)
    await t.onInit?.()

    const handled: MessageEnvelope[] = []
    try {
      await probe.xgroup('CREATE', tp, 'g', '$', 'MKSTREAM')
      const env = envelope(tp, { n: 1 })
      await t.publish(env)
      // One delivery to a consumer that never came back exhausts a budget of one: nobody is left to report the error.
      expect(await takeAsDeadConsumer(probe, tp, 'g', 1)).toHaveLength(1)

      await t.subscribe(
        tp,
        async (e) => {
          handled.push(e)
          return { status: 'ack' }
        },
        { group: 'g' },
      )

      await waitFor(async () => (await pending(probe, tp, 'g')).length === 0, 'the entry to be acked away')
      expect(handled).toHaveLength(0)
      expect(await dlqEnvelopes(probe, tp)).toHaveLength(0)
      expect(await probe.exists(`${tp}.dlq`)).toBe(0)
      expect(logs.errors.some((m) => m.includes(env.id))).toBe(true)
    } finally {
      await t.onDestroy?.()
      try {
        await drainKeys(probe, tp)
      } finally {
        await probe.quit()
      }
    }
  })

  it('logs a failing housekeeping channel once, not once per tick, and announces its recovery', async () => {
    const h = await sweepHarness()
    const sweeps = () => sweepLines(h.logs, h.topic)
    try {
      await h.transport.subscribe(h.topic, async () => ({ status: 'ack' }), { group: 'g' })

      h.fail(() => new Error('redis is gone'))

      await waitFor(() => sweeps().length > 0, 'the first failure to be logged')
      // Wording is load-bearing: log-based alerts match on it, so the first line of a run stays verbatim.
      expect(sweeps()[0].message).toBe(`retry sweep failed for ${h.topic}/g`)

      // ~50 more ticks. One line per tick is the behaviour this replaces; the window is 60s, so nothing else is due.
      await wait(1000)
      expect(sweeps()).toHaveLength(1)

      h.heal()
      await waitFor(() => h.logs.logs.some((m) => m.includes('recovered')), 'the recovery line')

      const recovery = h.logs.logs.find((m) => m.includes('recovered'))!
      expect(recovery).toContain(`retry sweep ${h.topic}/g`)
      // The suppressed failures are counted rather than lost, so the line says how bad it was.
      const failures = Number(/after (\d+) consecutive failures/.exec(recovery)?.[1])
      expect(failures).toBeGreaterThan(10)
      expect(sweeps()).toHaveLength(1)
    } finally {
      await h.close()
    }
  }, 15_000)

  it('logs a changed cause at once instead of burying it in the run it interrupts', async () => {
    const h = await sweepHarness()
    const sweeps = () => sweepLines(h.logs, h.topic)
    try {
      await h.transport.subscribe(h.topic, async () => ({ status: 'ack' }), { group: 'g' })

      h.fail(() => new Error('Connection is closed'))
      await waitFor(() => sweeps().length > 0, 'the first failure to be logged')
      // ~15 ticks of the one cause, all swallowed by the window.
      await wait(300)
      expect(sweeps()).toHaveLength(1)

      // The connection came back, but the group did not: a different and actionable cause, and the window has 60s left
      // to run - so it has to arrive on its own merit.
      h.fail(() => new Error('NOGROUP No such key or consumer group'))
      await waitFor(() => sweeps().length > 1, 'the changed cause to be logged')

      const [first, second] = sweeps()
      expect(first.detail).toContain('Connection is closed')
      expect(second.detail).toContain('NOGROUP')
      // Not conflated: the count follows the cause, so NOGROUP's first line carries none of the run before it.
      expect(second.message).toBe(`retry sweep failed for ${h.topic}/g`)

      // ~25 ticks of the new cause. Being news bought it one line, not an exemption.
      await wait(500)
      expect(sweeps()).toHaveLength(2)
    } finally {
      await h.close()
    }
  }, 15_000)

  it('bounds a cause that never repeats to a burst per window, not a line per tick', async () => {
    const h = await sweepHarness()
    const sweeps = () => sweepLines(h.logs, h.topic)
    try {
      await h.transport.subscribe(h.topic, async () => ({ status: 'ack' }), { group: 'g' })

      // Pathological detail: a fresh id on every failure, so every tick looks like a changed cause.
      h.fail(() => new Error(`NOSCRIPT No matching script ${randomUUID()}`))
      await waitFor(() => sweeps().length >= FAILURE_LOG_BURST, `${FAILURE_LOG_BURST} failure lines`)

      // ~50 more ticks, none of them a repeat. The window still has 60s to run and its budget is spent.
      await wait(1000)
      expect(sweeps()).toHaveLength(FAILURE_LOG_BURST)
      // Distinct causes throughout, so the cap is what held the count down and not some accidental deduplication.
      expect(new Set(sweeps().map((line) => line.detail)).size).toBe(FAILURE_LOG_BURST)
    } finally {
      await h.close()
    }
  }, 15_000)

  it('keeps a shared sweep run alive when one of its subscriptions unsubscribes', async () => {
    const h = await sweepHarness()
    const sweeps = () => sweepLines(h.logs, h.topic)
    const handler = async (): Promise<HandlerResult> => ({ status: 'ack' })
    try {
      // One explicit group, two subscriptions: competing consumers served by a single sweep, and so a single run.
      const first = await h.transport.subscribe(h.topic, handler, { group: 'shared' })
      await h.transport.subscribe(h.topic, handler, { group: 'shared' })

      h.fail(() => new Error('redis is gone'))
      await waitFor(() => sweeps().length > 0, 'the first failure to be logged')
      await wait(1000)

      await first.unsubscribe()
      // ~7 more ticks. The pair is still swept by the surviving subscription, so a second line here would mean the
      // unsubscribe had cleared a run it does not own.
      await wait(150)
      expect(sweeps()).toHaveLength(1)

      h.heal()
      await waitFor(() => h.logs.logs.some((m) => m.includes('recovered')), 'the recovery line')

      const recovery = h.logs.logs.find((m) => m.includes('recovered'))!
      expect(recovery).toContain(`retry sweep ${h.topic}/shared`)
      // The count spans the whole streak, both sides of the unsubscribe, rather than restarting at it.
      const failures = Number(/after (\d+) consecutive failures/.exec(recovery)?.[1])
      expect(failures).toBeGreaterThan(15)
    } finally {
      await h.close()
    }
  }, 15_000)

  it('drains a legacy retry ZSET entry and delivers it with a fresh attempt budget', async () => {
    const probe = new Redis(REDIS_URL!)
    const tp = `miia-test:retry-legacy-zset:${randomUUID()}`
    const t = new RedisStreamsTransport({
      client: new Redis(REDIS_URL!),
      retry: { backoffMs: 50, maxAttempts: 3 },
      retryIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 100,
    })
    await t.onInit?.()

    const seen: MessageEnvelope[] = []
    try {
      // Scheduled by a pre-PEL replica: its attempt budget is spent, and with no `lastError` it is not a DLQ record.
      const legacy: MessageEnvelope = { ...envelope(tp, { n: 7 }), meta: { timestamp: Date.now(), attempt: 3 } }
      await probe.zadd(`${tp}:retry`, Date.now() - 1000, JSON.stringify(legacy))

      await t.subscribe(
        tp,
        async (e) => {
          seen.push(e)
          return { status: 'ack' }
        },
        { group: 'g' },
      )

      await waitFor(() => seen.length === 1, 'the drained entry')
      expect(seen[0]?.id).toBe(legacy.id)
      expect(seen[0]?.payload).toEqual({ n: 7 })
      expect(seen[0]?.meta.attempt).toBe(1)
      await waitFor(async () => (await probe.zcard(`${tp}:retry`)) === 0, 'the legacy ZSET to be emptied')
    } finally {
      await t.onDestroy?.()
      try {
        await drainKeys(probe, tp)
      } finally {
        await probe.quit()
      }
    }
  })

  it('drains the legacy ZSET once per topic on subscribe, not once per retry tick', async () => {
    const probe = new Redis(REDIS_URL!)
    const busClient = new Redis(REDIS_URL!)
    const tp = `miia-test:retry-legacy-cadence:${randomUUID()}`
    const t = new RedisStreamsTransport({
      client: busClient,
      retry: { backoffMs: 50, maxAttempts: 3 },
      retryIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 100,
    })
    // The Lua command is defined on the client and looked up per call, so a counting wrapper here sees every drain.
    const lua = busClient as unknown as { drainRetry: (...args: unknown[]) => Promise<number> }
    const drainRetry = lua.drainRetry.bind(lua)
    let drains = 0
    lua.drainRetry = (...args) => {
      drains++
      return drainRetry(...args)
    }
    await t.onInit?.()

    const attempts: number[] = []
    try {
      await t.subscribe(
        tp,
        async (e): Promise<HandlerResult> => {
          attempts.push(e.meta.attempt)
          if (e.meta.attempt < 3) return { status: 'nack', error: new Error('transient') }
          return { status: 'ack' }
        },
        { group: 'g' },
      )
      expect(drains).toBe(1)

      // A second group reads the same `${tp}:retry` key, so it joins the schedule instead of starting one.
      await t.subscribe(tp, async () => ({ status: 'ack' }), { group: 'other' })
      expect(drains).toBe(1)

      await t.publish(envelope(tp))
      // Three attempts means two housekeeping passes redelivered the entry, so retry ticks demonstrably ran.
      await waitFor(() => attempts.length === 3, 'three attempts')
      // 10 more ticks at `retryIntervalMs` 50, still far short of the drain's own 10s base cadence.
      await wait(500)

      expect(attempts).toEqual([1, 2, 3])
      expect(drains).toBe(1)
    } finally {
      await t.onDestroy?.()
      try {
        await drainKeys(probe, tp)
      } finally {
        await Promise.all([probe.quit(), busClient.quit()])
      }
    }
  })

  it('still retries when only the deprecated retrySchedulerIntervalMs is set', async () => {
    const probe = new Redis(REDIS_URL!)
    const tp = `miia-test:retry-deprecated-alias:${randomUUID()}`
    const t = new RedisStreamsTransport({
      client: new Redis(REDIS_URL!),
      retry: { backoffMs: 50, maxAttempts: 3 },
      retrySchedulerIntervalMs: 50,
      minIdleMs: HORIZON_MS,
      blockMs: 100,
    })
    await t.onInit?.()

    const attempts: number[] = []
    try {
      await t.subscribe(
        tp,
        async (e): Promise<HandlerResult> => {
          attempts.push(e.meta.attempt)
          if (e.meta.attempt < 3) return { status: 'nack', error: new Error('transient') }
          return { status: 'ack' }
        },
        { group: 'g' },
      )
      await wait(50)

      await t.publish(envelope(tp))
      await waitFor(() => attempts.length === 3, 'three attempts on the deprecated cadence')

      expect(attempts).toEqual([1, 2, 3])
    } finally {
      await t.onDestroy?.()
      try {
        await drainKeys(probe, tp)
      } finally {
        await probe.quit()
      }
    }
  })

  it('resolves the interval aliases as retryIntervalMs > retrySchedulerIntervalMs > reclaimIntervalMs', () => {
    const interval = (options: Partial<RedisStreamsTransportOptions>): number =>
      (new RedisStreamsTransport({ url: REDIS_URL!, ...options }) as unknown as { retryIntervalMs: number })
        .retryIntervalMs

    expect(interval({})).toBe(1000)
    expect(interval({ reclaimIntervalMs: 222 })).toBe(222)
    expect(interval({ retrySchedulerIntervalMs: 111 })).toBe(111)
    expect(interval({ retrySchedulerIntervalMs: 111, reclaimIntervalMs: 222 })).toBe(111)
    expect(interval({ retryIntervalMs: 10, retrySchedulerIntervalMs: 111, reclaimIntervalMs: 222 })).toBe(10)
  })

  it('throws at construction when the retry config yields a horizon above the ceiling', () => {
    const build = (options: Partial<RedisStreamsTransportOptions>) => () =>
      new RedisStreamsTransport({ url: REDIS_URL!, ...options })

    // Level 8 of this schedule is 1e10 ms; Redis would accept the IDLE and park the entry until the heat death.
    expect(build({ retry: { backoffMs: 1000, backoffMultiplier: 10, maxAttempts: 9 } })).toThrow(/horizon/i)
    // The floor alone can breach it - the horizon is the max of the two.
    expect(build({ minIdleMs: 25 * 60 * 60 * 1000 })).toThrow(/horizon/i)
    expect(build({ retry: { backoffMs: 1000, maxAttempts: 5 }, minIdleMs: HORIZON_MS })).not.toThrow()
  })
})
