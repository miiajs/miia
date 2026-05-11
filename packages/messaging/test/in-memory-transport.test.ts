import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { inMemoryTransport, InMemoryTransport } from '../src/in-memory-transport.js'
import type { MessageEnvelope, MessageTransport, HandlerResult } from '../src/types.js'

function envelope(topic: string, payload: unknown = {}): MessageEnvelope {
  return {
    id: crypto.randomUUID(),
    topic,
    payload,
    meta: { timestamp: Date.now(), attempt: 1 },
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('InMemoryTransport', () => {
  let transport: MessageTransport

  beforeEach(() => {
    transport = inMemoryTransport({ retry: { backoffMs: 10, maxAttempts: 3 } })
  })

  afterEach(async () => {
    await transport.onDestroy?.()
  })

  it('delivers a published envelope to a subscriber', async () => {
    const received: MessageEnvelope[] = []
    await transport.subscribe(
      'topic',
      async (e) => {
        received.push(e)
        return { status: 'ack' }
      },
      {},
    )

    await transport.publish(envelope('topic', { id: 1 }))
    await wait(5)

    expect(received).toHaveLength(1)
    expect(received[0]?.payload).toEqual({ id: 1 })
  })

  it('publish does not wait for handler to complete (fire-and-forget)', async () => {
    // Handler takes 100ms. If publish awaited it, total elapsed would be ≥100ms.
    // With fire-and-forget, publish returns in ~0ms and the handler is still
    // in flight.
    let handlerFinished = false
    await transport.subscribe(
      'topic',
      async () => {
        await wait(100)
        handlerFinished = true
        return { status: 'ack' }
      },
      {},
    )

    const start = Date.now()
    await transport.publish(envelope('topic'))
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(20)
    expect(handlerFinished).toBe(false)

    await wait(150)
    expect(handlerFinished).toBe(true)
  })

  it('fans out to multiple subscribers on the same topic', async () => {
    const calls: string[] = []
    await transport.subscribe(
      'topic',
      async () => {
        calls.push('a')
        return { status: 'ack' }
      },
      {},
    )
    await transport.subscribe(
      'topic',
      async () => {
        calls.push('b')
        return { status: 'ack' }
      },
      {},
    )

    await transport.publish(envelope('topic'))
    await wait(5)

    expect(calls.sort()).toEqual(['a', 'b'])
  })

  it('retries on nack with exponential backoff', async () => {
    const attempts: number[] = []
    await transport.subscribe(
      'topic',
      async (e) => {
        attempts.push(e.meta.attempt)
        if (e.meta.attempt < 3) {
          return { status: 'nack', error: new Error('boom') }
        }
        return { status: 'ack' }
      },
      {},
    )

    await transport.publish(envelope('topic'))
    // backoff: 10ms (1→2) + 20ms (2→3) = 30ms
    await wait(80)

    expect(attempts).toEqual([1, 2, 3])
  })

  it('retries on thrown exception (implicit nack)', async () => {
    const attempts: number[] = []
    await transport.subscribe(
      'topic',
      async (e) => {
        attempts.push(e.meta.attempt)
        if (e.meta.attempt < 2) throw new Error('oops')
        return { status: 'ack' }
      },
      {},
    )

    await transport.publish(envelope('topic'))
    await wait(50)

    expect(attempts).toEqual([1, 2])
  })

  it('preserves traceparent and tracestate across retry attempts', async () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const tracestate = 'vendor1=opaqueValue'
    const seen: Array<{ traceparent?: string; tracestate?: string }> = []

    await transport.subscribe(
      'topic',
      async (e) => {
        seen.push({ traceparent: e.meta.traceparent, tracestate: e.meta.tracestate })
        if (e.meta.attempt < 3) return { status: 'nack', error: new Error('boom') }
        return { status: 'ack' }
      },
      {},
    )

    await transport.publish({
      id: crypto.randomUUID(),
      topic: 'topic',
      payload: {},
      meta: { timestamp: Date.now(), attempt: 1, traceparent, tracestate },
    })
    // backoff: 10ms + 20ms = 30ms for 3 attempts
    await wait(80)

    expect(seen).toHaveLength(3)
    for (const s of seen) {
      expect(s.traceparent).toBe(traceparent)
      expect(s.tracestate).toBe(tracestate)
    }
  })

  it('moves message to <topic>.dlq after maxAttempts', async () => {
    const dlqReceived: MessageEnvelope[] = []
    await transport.subscribe('topic', async () => ({ status: 'nack', error: new Error('permanent') }), {})
    await transport.subscribe(
      'topic.dlq',
      async (e) => {
        dlqReceived.push(e)
        return { status: 'ack' }
      },
      {},
    )

    await transport.publish(envelope('topic', { id: 42 }))
    // retry delays: 10 + 20 + 40 = 70ms, then DLQ publish
    await wait(200)

    expect(dlqReceived).toHaveLength(1)
    expect(dlqReceived[0]?.topic).toBe('topic.dlq')
    expect(dlqReceived[0]?.payload).toEqual({ id: 42 })
    expect(dlqReceived[0]?.meta.lastError).toBe('permanent')
  })

  it('does not publish to DLQ when retry.dlq is false', async () => {
    const t = inMemoryTransport({ retry: { backoffMs: 5, maxAttempts: 2, dlq: false } })
    const dlqReceived: MessageEnvelope[] = []
    await t.subscribe('topic', async () => ({ status: 'nack', error: new Error('x') }), {})
    await t.subscribe(
      'topic.dlq',
      async (e) => {
        dlqReceived.push(e)
        return { status: 'ack' }
      },
      {},
    )

    await t.publish(envelope('topic'))
    await wait(50)

    expect(dlqReceived).toHaveLength(0)
    await t.onDestroy?.()
  })

  it('cloneOnPublish isolates payload mutations between handlers', async () => {
    const t = inMemoryTransport({ cloneOnPublish: true, retry: { backoffMs: 5 } })
    let second: Record<string, unknown> | undefined
    await t.subscribe(
      'topic',
      async (e) => {
        ;(e.payload as Record<string, unknown>).mutated = true
        return { status: 'ack' }
      },
      {},
    )
    await t.subscribe(
      'topic',
      async (e) => {
        second = e.payload as Record<string, unknown>
        return { status: 'ack' }
      },
      {},
    )

    await t.publish(envelope('topic', { id: 1 }))
    await wait(10)

    expect(second).toEqual({ id: 1 })
    expect(second).not.toHaveProperty('mutated')
    await t.onDestroy?.()
  })

  it('unsubscribe stops further deliveries', async () => {
    const calls: number[] = []
    const sub = await transport.subscribe(
      'topic',
      async () => {
        calls.push(1)
        return { status: 'ack' }
      },
      {},
    )

    await transport.publish(envelope('topic'))
    await wait(5)
    expect(calls).toHaveLength(1)

    await sub.unsubscribe()
    await transport.publish(envelope('topic'))
    await wait(5)
    expect(calls).toHaveLength(1)
  })

  it('onDestroy cancels pending retry timers', async () => {
    let deliveryCount = 0
    await transport.subscribe(
      'topic',
      async () => {
        deliveryCount++
        return { status: 'nack', error: new Error('x') }
      },
      {},
    )

    await transport.publish(envelope('topic'))
    await wait(5) // first attempt fires
    expect(deliveryCount).toBe(1)

    await transport.onDestroy?.()
    await wait(50) // retry would have fired at ~10ms - but was cancelled
    expect(deliveryCount).toBe(1)
  })

  it('InMemoryTransport class is directly instantiable', () => {
    const t = new InMemoryTransport()
    expect(t).toBeInstanceOf(InMemoryTransport)
  })

  describe('dispatch capability', () => {
    it('declares supportedModes=["sliding"] and defaultMode="sliding"', () => {
      const t = new InMemoryTransport()
      expect(t.supportedModes).toEqual(['sliding'])
      expect(t.defaultMode).toBe('sliding')
    })

    it('declares supportsCompetingConsumers=false', () => {
      const t = new InMemoryTransport()
      expect(t.supportsCompetingConsumers).toBe(false)
    })

    it('subscribe accepts mode="sliding" without error', async () => {
      const t = inMemoryTransport({ retry: { backoffMs: 5 } })
      const sub = await t.subscribe('topic', async () => ({ status: 'ack' }), { mode: 'sliding', concurrency: 4 })
      await sub.unsubscribe()
      await t.onDestroy?.()
    })
  })

  describe('graceful drain', () => {
    it('onDestroy waits for in-flight handler to complete (default drain)', async () => {
      const t = inMemoryTransport({ retry: { backoffMs: 10, maxAttempts: 3 }, drainTimeoutMs: 1000 })
      let handlerFinished = false

      await t.subscribe(
        'topic',
        async () => {
          await wait(100)
          handlerFinished = true
          return { status: 'ack' }
        },
        {},
      )

      await t.publish(envelope('topic'))
      await wait(10) // give microtask + handler start time

      const destroyStart = Date.now()
      await t.onDestroy?.()
      const elapsed = Date.now() - destroyStart

      expect(handlerFinished).toBe(true)
      expect(elapsed).toBeGreaterThanOrEqual(80) // waited for handler
    })

    it('onDestroy returns within drainTimeoutMs even if handler still running', async () => {
      const t = inMemoryTransport({ retry: { backoffMs: 10, maxAttempts: 3 }, drainTimeoutMs: 50 })
      let handlerFinished = false

      await t.subscribe(
        'topic',
        async () => {
          await wait(500)
          handlerFinished = true
          return { status: 'ack' }
        },
        {},
      )

      await t.publish(envelope('topic'))
      await wait(10)

      const destroyStart = Date.now()
      await t.onDestroy?.()
      const elapsed = Date.now() - destroyStart

      expect(elapsed).toBeLessThan(200) // bailed out around 50ms (drain timeout)
      expect(handlerFinished).toBe(false) // handler still running when we returned
    })

    it('drainTimeoutMs: 0 skips drain entirely', async () => {
      const t = inMemoryTransport({ retry: { backoffMs: 10, maxAttempts: 3 }, drainTimeoutMs: 0 })
      let handlerFinished = false

      await t.subscribe(
        'topic',
        async () => {
          await wait(200)
          handlerFinished = true
          return { status: 'ack' }
        },
        {},
      )

      await t.publish(envelope('topic'))
      await wait(10)

      const destroyStart = Date.now()
      await t.onDestroy?.()
      const elapsed = Date.now() - destroyStart

      expect(elapsed).toBeLessThan(20) // immediate cleanup
      expect(handlerFinished).toBe(false)
    })

    it('refuses new deliveries during drain', async () => {
      const t = inMemoryTransport({ retry: { backoffMs: 10, maxAttempts: 3 }, drainTimeoutMs: 500 })
      let firstStarted = false
      let secondStarted = false

      await t.subscribe(
        'topic',
        async () => {
          firstStarted = true
          await wait(50)
          return { status: 'ack' }
        },
        {},
      )

      await t.publish(envelope('topic'))
      await wait(10)
      expect(firstStarted).toBe(true)

      // Start destroy while first handler is in flight, then publish more
      const destroyPromise = t.onDestroy?.()

      // re-subscribe with a different handler to detect any new delivery
      await t.subscribe(
        'topic',
        async () => {
          secondStarted = true
          return { status: 'ack' }
        },
        {},
      )
      await t.publish(envelope('topic'))
      await wait(20)

      await destroyPromise
      expect(secondStarted).toBe(false)
    })
  })
})
