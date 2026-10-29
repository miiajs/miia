import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { createToken, Injectable, inject, type LoggerService, Module, provider } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { z } from 'zod'
import { defineEvent, dlqEvent, type EventPayload } from '../src/contract.js'
import { Idempotent, On } from '../src/decorators.js'
import { MessageBus } from '../src/message-bus.js'
import { memoryIdempotencyStore } from '../src/idempotency.js'
import { inMemoryTransport } from '../src/in-memory-transport.js'
import { MessagingModule } from '../src/messaging.module.js'
import { idempotencyStoreToken, messageBus, transportToken } from '../src/tokens.js'
import type { MessageMeta, MessageTransport } from '../src/types.js'
import { stubTransport } from './fixtures/stub-transport.js'

const UserCreated = defineEvent('user.created')
const X = defineEvent('x')
const Traced = defineEvent('traced')
const Topic = defineEvent('topic')
const PingFired = defineEvent('ping.fired')
const OrderCreated = defineEvent('order.created')
const Payment = defineEvent('payment')
const OrderPlaced = defineEvent('order.placed')

function transportProvider(transport?: MessageTransport) {
  const t = transport ?? inMemoryTransport({ retry: { backoffMs: 10, maxAttempts: 3 }, drainTimeoutMs: 100 })
  return [
    { token: transportToken(), factory: () => t },
    { token: idempotencyStoreToken(), factory: () => null },
    { token: MessageBus, factory: () => new MessageBus(t, null, null) },
  ]
}

function busWithIdempotency(transport?: MessageTransport) {
  const t = transport ?? inMemoryTransport({ retry: { backoffMs: 10, maxAttempts: 3 }, drainTimeoutMs: 100 })
  const store = memoryIdempotencyStore()
  return [
    { token: transportToken(), factory: () => t },
    { token: idempotencyStoreToken(), factory: () => store },
    { token: MessageBus, factory: () => new MessageBus(t, store, null) },
  ]
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** `TestApp` builds the app with `logger: false`, so a dropped message is read off the transport's own logger. */
function captureErrors(transport: MessageTransport): string[] {
  const errors: string[] = []
  const recorder: LoggerService = {
    log: () => {},
    warn: () => {},
    error: (message) => {
      errors.push(message)
    },
    debug: () => {},
  }
  ;(transport as unknown as { logger: LoggerService }).logger = recorder
  return errors
}

describe('MessageBus', () => {
  let cleanup: Array<() => Promise<void>> = []

  afterEach(async () => {
    for (const fn of cleanup) await fn()
    cleanup = []
  })

  it('delivers an emitted event to an @On handler on a provider', async () => {
    @Injectable()
    class UserHandlers {
      received: unknown[] = []

      @On(UserCreated)
      async onCreate(payload: unknown) {
        this.received.push(payload)
      }
    }

    @Module({ providers: [UserHandlers] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .provide(...transportProvider())
      .compile()
    cleanup.push(() => app.close())

    const bus = app.resolve(MessageBus)
    const users = app.resolve(UserHandlers)

    await bus.publish(UserCreated, { id: '1' })
    await wait(20)

    expect(users.received).toEqual([{ id: '1' }])
  })

  it('fans out to multiple @On handlers across different providers', async () => {
    @Injectable()
    class EmailService {
      calls: unknown[] = []
      @On(UserCreated)
      async send(p: unknown) {
        this.calls.push(p)
      }
    }

    @Injectable()
    class MetricsService {
      calls: unknown[] = []
      @On(UserCreated)
      async track(p: unknown) {
        this.calls.push(p)
      }
    }

    @Module({ providers: [EmailService, MetricsService] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .provide(...transportProvider())
      .compile()
    cleanup.push(() => app.close())

    await app.resolve(MessageBus).publish(UserCreated, { id: 42 })
    await wait(20)

    expect(app.resolve(EmailService).calls).toEqual([{ id: 42 }])
    expect(app.resolve(MetricsService).calls).toEqual([{ id: 42 }])
  })

  it('passes MessageMeta as the second argument to handlers', async () => {
    @Injectable()
    class H {
      lastMeta: unknown
      @On(X)
      async onX(_p: unknown, meta: unknown) {
        this.lastMeta = meta
      }
    }

    @Module({ providers: [H] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .provide(...transportProvider())
      .compile()
    cleanup.push(() => app.close())

    await app.resolve(MessageBus).publish(X, {}, { correlationId: 'abc' })
    await wait(15)

    const meta = app.resolve(H).lastMeta as { correlationId?: string; attempt?: number; timestamp?: number }
    expect(meta?.correlationId).toBe('abc')
    expect(meta?.attempt).toBe(1)
    expect(typeof meta?.timestamp).toBe('number')
  })

  it('propagates W3C trace context fields (traceparent, tracestate) through publish → handler', async () => {
    @Injectable()
    class H {
      lastMeta: unknown
      @On(Traced)
      async onX(_p: unknown, meta: unknown) {
        this.lastMeta = meta
      }
    }

    @Module({ providers: [H] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .provide(...transportProvider())
      .compile()
    cleanup.push(() => app.close())

    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const tracestate = 'vendor1=opaqueValue,vendor2=other'
    await app.resolve(MessageBus).publish(Traced, {}, { traceparent, tracestate })
    await wait(15)

    const meta = app.resolve(H).lastMeta as { traceparent?: string; tracestate?: string }
    expect(meta?.traceparent).toBe(traceparent)
    expect(meta?.tracestate).toBe(tracestate)
  })

  it('isolated retry: throwing handler retries alone, sibling handlers do not re-run', async () => {
    @Injectable()
    class Good {
      calls = 0
      @On(Topic)
      async ok() {
        this.calls++
      }
    }

    @Injectable()
    class Bad {
      calls = 0
      @On(Topic)
      async fail() {
        this.calls++
        if (this.calls < 2) throw new Error('transient')
      }
    }

    @Module({ providers: [Good, Bad] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .provide(...transportProvider())
      .compile()
    cleanup.push(() => app.close())

    await app.resolve(MessageBus).publish(Topic, {})
    await wait(60)

    // Each handler has its own subscription with its own ack/nack lifecycle.
    // Good acks on attempt 1 - never retried.
    // Bad throws on attempt 1 → its own nack → retry → success on attempt 2.
    expect(app.resolve(Good).calls).toBe(1)
    expect(app.resolve(Bad).calls).toBe(2)
  })

  it('permanent handler failure ends up on <topic>.dlq', async () => {
    @Injectable()
    class Broken {
      @On(Topic)
      async fail() {
        throw new Error('permanent')
      }
    }

    @Injectable()
    class DlqListener {
      received: Array<{ payload: unknown; lastError?: string }> = []
      @On(dlqEvent(Topic))
      async onDlq(payload: unknown, meta: { lastError?: string }) {
        this.received.push({ payload, lastError: meta.lastError })
      }
    }

    @Module({ providers: [Broken, DlqListener] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .provide(...transportProvider())
      .compile()
    cleanup.push(() => app.close())

    await app.resolve(MessageBus).publish(Topic, { id: 7 })
    // backoff 10+20+40 = 70ms for 3 attempts, plus DLQ dispatch
    await wait(200)

    const dlq = app.resolve(DlqListener)
    expect(dlq.received).toHaveLength(1)
    expect(dlq.received[0]?.payload).toEqual({ id: 7 })
    expect(dlq.received[0]?.lastError).toBe('permanent')
  })

  it('@On on a controller method is also discovered', async () => {
    const { Controller, Get } = await import('@miiajs/core')

    @Controller('/ping')
    class PingController {
      hits = 0
      @Get('/')
      ping() {
        return 'pong'
      }
      @On(PingFired)
      async onPing() {
        this.hits++
      }
    }

    @Module({ controllers: [PingController] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .provide(...transportProvider())
      .compile()
    cleanup.push(() => app.close())

    await app.resolve(MessageBus).publish(PingFired, null)
    await wait(15)

    expect(app.resolve(PingController).hits).toBe(1)
  })

  it('delivers to an @On handler behind a factory provider under a token object', async () => {
    class OrderHandlers {
      received: unknown[] = []

      @On(OrderCreated)
      async onCreated(payload: unknown) {
        this.received.push(payload)
      }
    }
    const HANDLERS = createToken<OrderHandlers>('OrderHandlers')

    @Module({ providers: [provider(HANDLERS, () => new OrderHandlers())] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .provide(...transportProvider())
      .compile()
    cleanup.push(() => app.close())

    await app.resolve(MessageBus).publish(OrderCreated, { id: 1 })
    await wait(20)

    expect(app.resolve(HANDLERS).received).toEqual([{ id: 1 }])
  })

  it('derives the consumer group from the class of the handler instance', async () => {
    const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

    @Injectable()
    class BaseHandler {
      @On(Topic)
      async run() {}
    }

    class DerivedHandler extends BaseHandler {}

    @Module({ providers: [provider(BaseHandler, () => new DerivedHandler())] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .provide(...transportProvider(t))
      .compile()
    cleanup.push(() => app.close())

    expect(t.subscribes).toHaveLength(1)
    expect(t.subscribes[0]?.options.group).toBe('topic__DerivedHandler_run')
  })

  it('throws at startup when one @On class is provided twice', async () => {
    @Injectable()
    class Handlers {
      @On(Topic)
      async onCreated() {}
    }
    const COPY = createToken<Handlers>('HandlersCopy')

    @Module({ providers: [Handlers, provider(COPY, () => new Handlers())] })
    class AppModule {}

    const promise = TestApp.create(AppModule)
      .provide(...transportProvider())
      .compile()
    await expect(promise).rejects.toThrow(
      '[messaging] @On on Handlers.onCreated is found on two instances - provide Handlers once: both would subscribe ' +
        "as consumer group 'topic__Handlers_onCreated'",
    )
  })

  describe('@Idempotent', () => {
    it('skips a duplicate delivery when the same envelope retries', async () => {
      @Injectable()
      class H {
        calls = 0
        @On(Topic)
        @Idempotent({ ttl: 60_000 })
        async run() {
          this.calls++
          // Throw on attempt 1 so the transport retries with same envelope.id.
          if (this.calls === 1) throw new Error('transient')
        }
      }

      @Module({ providers: [H] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busWithIdempotency())
        .compile()
      cleanup.push(() => app.close())

      await app.resolve(MessageBus).publish(Topic, {})
      await wait(60) // retry happens after backoff

      // Attempt 1: claim → handler runs → throws → release. Attempt 2: claim
      // succeeds again, handler runs and acks.
      expect(app.resolve(H).calls).toBe(2)
    })

    it('uses per-handler default key so two @Idempotent handlers on the same topic do not conflict', async () => {
      @Injectable()
      class A {
        calls = 0
        @On(Topic)
        @Idempotent({ ttl: 60_000 })
        async run() {
          this.calls++
        }
      }
      @Injectable()
      class B {
        calls = 0
        @On(Topic)
        @Idempotent({ ttl: 60_000 })
        async run() {
          this.calls++
        }
      }

      @Module({ providers: [A, B] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busWithIdempotency())
        .compile()
      cleanup.push(() => app.close())

      await app.resolve(MessageBus).publish(Topic, {})
      await wait(20)

      // Both handlers ran (per-handler default key isolates them).
      expect(app.resolve(A).calls).toBe(1)
      expect(app.resolve(B).calls).toBe(1)
    })

    it('respects a custom key from payload', async () => {
      @Injectable()
      class H {
        calls: unknown[] = []
        @On(Payment)
        @Idempotent({ ttl: 60_000, key: (p) => `txn:${(p as { txId: string }).txId}` })
        async run(p: unknown) {
          this.calls.push(p)
        }
      }

      @Module({ providers: [H] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busWithIdempotency())
        .compile()
      cleanup.push(() => app.close())

      const bus = app.resolve(MessageBus)
      // Two emissions with the same business id but different envelope.id
      await bus.publish(Payment, { txId: 'tx-1' })
      await bus.publish(Payment, { txId: 'tx-1' })
      await bus.publish(Payment, { txId: 'tx-2' })
      await wait(20)

      // Only two handler runs - duplicate tx-1 was skipped.
      expect(app.resolve(H).calls).toHaveLength(2)
    })

    it('throws at startup when @Idempotent is used without a configured store', async () => {
      @Injectable()
      class H {
        @On(Topic)
        @Idempotent({ ttl: 60_000 })
        async run() {}
      }

      @Module({ providers: [H] })
      class AppModule {}

      // No idempotencyProvider() - bus should reject at compile (onReady).
      const promise = TestApp.create(AppModule)
        .provide(...transportProvider())
        .compile()
      await expect(promise).rejects.toThrow(/@Idempotent.*requires an IdempotencyStore/)
    })
  })

  describe('multi-bus', () => {
    it('default + named bus coexist with separate handlers', async () => {
      @Injectable()
      class DefaultHandler {
        calls: unknown[] = []
        @On(Topic)
        async run(p: unknown) {
          this.calls.push(p)
        }
      }

      @Injectable()
      class KafkaHandler {
        calls: unknown[] = []
        @On(Topic, { bus: 'kafka' })
        async run(p: unknown) {
          this.calls.push(p)
        }
      }

      @Module({
        imports: [
          MessagingModule.configure({ transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }) }),
          MessagingModule.configure(
            { transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }) },
            { name: 'kafka' },
          ),
        ],
        providers: [DefaultHandler, KafkaHandler],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      cleanup.push(() => app.close())

      const defaultBus = app.resolve(MessageBus)
      const kafkaBus = app.resolve(messageBus('kafka'))

      // Different instances
      expect(defaultBus).not.toBe(kafkaBus)

      await defaultBus.publish(Topic, { from: 'default' })
      await kafkaBus.publish(Topic, { from: 'kafka' })
      await wait(20)

      expect(app.resolve(DefaultHandler).calls).toEqual([{ from: 'default' }])
      expect(app.resolve(KafkaHandler).calls).toEqual([{ from: 'kafka' }])
    })

    it('handler targeted at named bus does not run on default bus emit', async () => {
      @Injectable()
      class KafkaOnly {
        calls = 0
        @On(Topic, { bus: 'kafka' })
        async run() {
          this.calls++
        }
      }

      @Module({
        imports: [
          MessagingModule.configure({ transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }) }),
          MessagingModule.configure(
            { transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }) },
            { name: 'kafka' },
          ),
        ],
        providers: [KafkaOnly],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      cleanup.push(() => app.close())

      // Default bus emits - KafkaOnly should NOT run
      await app.resolve(MessageBus).publish(Topic, {})
      await wait(20)
      expect(app.resolve(KafkaOnly).calls).toBe(0)

      // Kafka bus emits - KafkaOnly runs
      await app.resolve(messageBus('kafka')).publish(Topic, {})
      await wait(20)
      expect(app.resolve(KafkaOnly).calls).toBe(1)
    })

    it("@On with bus: '' subscribes to the default bus", async () => {
      @Injectable()
      class EmptyName {
        calls = 0
        @On(Topic, { bus: '' })
        async run() {
          this.calls++
        }
      }

      @Module({
        imports: [
          MessagingModule.configure({ transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }) }),
        ],
        providers: [EmptyName],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      cleanup.push(() => app.close())

      await app.resolve(MessageBus).publish(Topic, {})
      await wait(20)
      expect(app.resolve(EmptyName).calls).toBe(1)
    })

    it('throws at startup when @On references an unknown bus', async () => {
      @Injectable()
      class Bad {
        @On(Topic, { bus: 'unknown' })
        async run() {}
      }

      @Module({
        imports: [
          MessagingModule.configure({ transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }) }),
        ],
        providers: [Bad],
      })
      class AppModule {}

      const promise = TestApp.create(AppModule).compile()
      await expect(promise).rejects.toThrow(
        /references bus 'unknown', but no MessagingModule\.configure\(opts, \{ name: 'unknown' \}\) is registered/,
      )
    })

    it('throws when @On (no bus) is used but no default MessagingModule is registered', async () => {
      @Injectable()
      class Lonely {
        @On(Topic)
        async run() {}
      }

      @Module({
        imports: [
          MessagingModule.configure(
            { transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }) },
            { name: 'kafka' },
          ),
        ],
        providers: [Lonely],
      })
      class AppModule {}

      const promise = TestApp.create(AppModule).compile()
      await expect(promise).rejects.toThrow(
        /references bus '<default>', but no MessagingModule\.configure\(opts\) is registered/,
      )
    })

    it('accepts an @On that targets a bus configured in another module', async () => {
      @Injectable()
      class AuditHandlers {
        received: unknown[] = []
        @On(OrderPlaced, { bus: 'audit' })
        async run(payload: unknown) {
          this.received.push(payload)
        }
      }

      // Neither configuration is global: the default bus and the handler live in OrdersModule only
      @Module({
        imports: [
          MessagingModule.configure({ transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }) }),
        ],
        providers: [AuditHandlers],
      })
      class OrdersModule {}

      @Module({
        imports: [
          MessagingModule.configure(
            { transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }) },
            { name: 'audit' },
          ),
        ],
      })
      class AuditModule {}

      @Module({ imports: [OrdersModule, AuditModule] })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      cleanup.push(() => app.close())

      await app.resolve(messageBus('audit')).publish(OrderPlaced, { id: '1' })
      await wait(20)
      expect(app.resolve(AuditHandlers).received).toEqual([{ id: '1' }])
    })

    it('per-bus idempotency stores are isolated', async () => {
      @Injectable()
      class DefaultH {
        calls = 0
        @On(Topic)
        @Idempotent({ ttl: 60_000 })
        async run() {
          this.calls++
        }
      }

      @Injectable()
      class KafkaH {
        calls = 0
        @On(Topic, { bus: 'kafka' })
        @Idempotent({ ttl: 60_000 })
        async run() {
          this.calls++
        }
      }

      @Module({
        imports: [
          MessagingModule.configure({
            transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }),
            idempotency: memoryIdempotencyStore(),
          }),
          MessagingModule.configure(
            {
              transport: inMemoryTransport({ retry: { backoffMs: 5 }, drainTimeoutMs: 50 }),
              idempotency: memoryIdempotencyStore(),
            },
            { name: 'kafka' },
          ),
        ],
        providers: [DefaultH, KafkaH],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      cleanup.push(() => app.close())

      // Each bus delivers once - claims live in separate stores, no collisions.
      await app.resolve(MessageBus).publish(Topic, {})
      await app.resolve(messageBus('kafka')).publish(Topic, {})
      await wait(20)

      expect(app.resolve(DefaultH).calls).toBe(1)
      expect(app.resolve(KafkaH).calls).toBe(1)
    })
  })

  describe('event contracts', () => {
    const OrderSubmitted = defineEvent('order.submitted', z.object({ id: z.string(), total: z.number() }))

    @Injectable()
    class DeadOrders {
      received: Array<{ payload: unknown; meta: MessageMeta }> = []
      @On(dlqEvent(OrderSubmitted))
      async on(payload: unknown, meta: MessageMeta) {
        this.received.push({ payload, meta })
      }
    }

    it('hands the handler what the schema returns', async () => {
      const Stamped = defineEvent(
        'stamped',
        z.object({ at: z.coerce.date(), name: z.string().transform((s) => s.toUpperCase()) }),
      )

      @Injectable()
      class H {
        received: EventPayload<typeof Stamped>[] = []
        @On(Stamped)
        async on(payload: EventPayload<typeof Stamped>) {
          this.received.push(payload)
        }
      }

      @Module({ providers: [H] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...transportProvider())
        .compile()
      cleanup.push(() => app.close())

      await app.resolve(MessageBus).publish(Stamped, { at: '2026-10-31T12:00:00.000Z', name: 'ada' })
      await wait(20)

      const received = app.resolve(H).received
      expect(received).toHaveLength(1)
      expect(received[0]?.at).toBeInstanceOf(Date)
      expect(received[0]).toEqual({ at: new Date('2026-10-31T12:00:00.000Z'), name: 'ADA' })
    })

    it('dead-letters a payload that does not match the schema at once, without calling the handler', async () => {
      @Injectable()
      class H {
        calls = 0
        @On(OrderSubmitted)
        async on() {
          this.calls++
        }
      }

      @Module({ providers: [H, DeadOrders] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...transportProvider())
        .compile()
      cleanup.push(() => app.close())

      await app.resolve(MessageBus).publish(OrderSubmitted, { id: 'o-1', total: 'lots' } as never)
      // maxAttempts is 3: two retries at 10 + 20ms would land in here.
      await wait(100)

      expect(app.resolve(H).calls).toBe(0)
      const dead = app.resolve(DeadOrders).received
      expect(dead).toHaveLength(1)
      expect(dead[0]?.payload).toEqual({ id: 'o-1', total: 'lots' })
      expect(dead[0]?.meta.attempt).toBe(1)
      expect(dead[0]?.meta.lastError).toStartWith("Payload validation failed for 'order.submitted': total: ")
    })

    it('drops a payload that does not match the schema when the DLQ is off', async () => {
      const t = inMemoryTransport({ retry: { backoffMs: 10, maxAttempts: 3, dlq: false }, drainTimeoutMs: 100 })
      const errors = captureErrors(t)

      @Injectable()
      class H {
        calls = 0
        @On(OrderSubmitted)
        async on() {
          this.calls++
        }
      }

      @Module({ providers: [H, DeadOrders] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...transportProvider(t))
        .compile()
      cleanup.push(() => app.close())

      await app.resolve(MessageBus).publish(OrderSubmitted, { id: 'o-1' } as never)
      await wait(100)

      expect(app.resolve(H).calls).toBe(0)
      expect(app.resolve(DeadOrders).received).toHaveLength(0)
      expect(errors.some((m) => m.includes('on order.submitted rejected without retry'))).toBe(true)
    })

    it('validates before @Idempotent claims, and hands key() the parsed payload', async () => {
      const Charge = defineEvent('charge', z.object({ txId: z.string().trim() }))
      const keys: unknown[] = []

      @Injectable()
      class H {
        calls: unknown[] = []
        @On(Charge)
        @Idempotent({
          ttl: 60_000,
          key: (p: EventPayload<typeof Charge>) => {
            keys.push(p)
            return `tx:${p.txId}`
          },
        })
        async on(payload: EventPayload<typeof Charge>) {
          this.calls.push(payload)
        }
      }

      @Module({ providers: [H] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busWithIdempotency())
        .compile()
      cleanup.push(() => app.close())

      const claim = spyOn(app.resolve(idempotencyStoreToken())!, 'claim')
      const bus = app.resolve(MessageBus)

      await bus.publish(Charge, { txId: 42 } as never)
      await wait(20)
      expect(claim).not.toHaveBeenCalled()
      expect(keys).toEqual([])

      await bus.publish(Charge, { txId: '  tx-1  ' })
      await wait(20)
      expect(keys).toEqual([{ txId: 'tx-1' }])
      expect(claim).toHaveBeenCalledTimes(1)
      expect(claim.mock.calls[0]?.[0]).toBe('tx:tx-1')
      expect(app.resolve(H).calls).toEqual([{ txId: 'tx-1' }])
    })

    it('delivers the payload of an event without a schema as it is', async () => {
      const Raw = defineEvent('raw')

      @Injectable()
      class H {
        received: unknown[] = []
        @On(Raw)
        async on(payload: unknown) {
          this.received.push(payload)
        }
      }

      @Module({ providers: [H] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...transportProvider())
        .compile()
      cleanup.push(() => app.close())

      const payload = { at: '2026-10-31T12:00:00.000Z' }
      await app.resolve(MessageBus).publish(Raw, payload)
      await wait(20)

      expect(app.resolve(H).received).toHaveLength(1)
      expect(app.resolve(H).received[0]).toBe(payload)
    })

    it('rejects on the first attempt when the schema throws instead of returning', async () => {
      // zod throws from a synchronous safeParse() that meets an async refine.
      const Checked = defineEvent(
        'checked',
        z.object({ id: z.string() }).refine(async () => true),
      )
      const DeadChecked = dlqEvent(Checked)

      @Injectable()
      class H {
        calls = 0
        dead: MessageMeta[] = []
        @On(Checked)
        async on() {
          this.calls++
        }
        @On(DeadChecked)
        async onDead(_payload: unknown, meta: MessageMeta) {
          this.dead.push(meta)
        }
      }

      @Module({ providers: [H] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...transportProvider())
        .compile()
      cleanup.push(() => app.close())

      await app.resolve(MessageBus).publish(Checked, { id: 'c-1' })
      await wait(100)

      const h = app.resolve(H)
      expect(h.calls).toBe(0)
      expect(h.dead).toHaveLength(1)
      expect(h.dead[0]?.attempt).toBe(1)
      expect(h.dead[0]?.lastError).toStartWith("Payload validation failed for 'checked': ")
    })

    it('names the path of each issue, the root and a symbol key included', async () => {
      const key = Symbol('meta')
      const Odd = defineEvent('odd', {
        safeParse: () => ({
          success: false as const,
          error: {
            issues: [
              { path: [], message: 'Expected object' },
              { path: [key, 0], message: 'Bad' },
            ],
          },
        }),
      })

      @Injectable()
      class H {
        dead: MessageMeta[] = []
        @On(Odd)
        async on() {}
        @On(dlqEvent(Odd))
        async onDead(_payload: unknown, meta: MessageMeta) {
          this.dead.push(meta)
        }
      }

      @Module({ providers: [H] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...transportProvider())
        .compile()
      cleanup.push(() => app.close())

      await app.resolve(MessageBus).publish(Odd, {})
      await wait(20)

      expect(app.resolve(H).dead.map((m) => m.lastError)).toEqual([
        "Payload validation failed for 'odd': (root): Expected object; Symbol(meta).0: Bad",
      ])
    })

    it('publish() rejects a string topic and says how to define the event', async () => {
      @Module({})
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...transportProvider())
        .compile()
      cleanup.push(() => app.close())

      const bus = app.resolve(MessageBus)
      await expect(bus.publish('x' as never, {} as never)).rejects.toThrow(TypeError)
      await expect(bus.publish('x' as never, {} as never)).rejects.toThrow(
        "[messaging] publish() takes an event contract from defineEvent(), got the string 'x' - " +
          "define it with defineEvent('x', schema)",
      )
    })

    it('@On with a string topic throws when the class is defined', () => {
      expect(() => {
        class S {
          @On('x' as never)
          on() {}
        }
        return S
      }).toThrow(
        new TypeError(
          "[messaging] @On takes an event contract from defineEvent(), got the string 'x' - " +
            "define it with defineEvent('x', schema)",
        ),
      )
    })
  })

  it('MessageBus can be injected as a dependency of another provider', async () => {
    @Injectable()
    class Publisher {
      private bus = inject(MessageBus)
      async go() {
        await this.bus.publish(Topic, { hello: 'world' })
      }
    }

    @Injectable()
    class Consumer {
      received: unknown[] = []
      @On(Topic)
      async on(p: unknown) {
        this.received.push(p)
      }
    }

    @Module({ providers: [Publisher, Consumer] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .provide(...transportProvider())
      .compile()
    cleanup.push(() => app.close())

    await app.resolve(Publisher).go()
    await wait(15)

    expect(app.resolve(Consumer).received).toEqual([{ hello: 'world' }])
  })
})
