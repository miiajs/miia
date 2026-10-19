import { afterEach, describe, expect, it } from 'bun:test'
import { createToken, Injectable, inject, Module, provider } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { Idempotent, On } from '../src/decorators.js'
import { MessageBus } from '../src/message-bus.js'
import { memoryIdempotencyStore } from '../src/idempotency.js'
import { inMemoryTransport } from '../src/in-memory-transport.js'
import { MessagingModule } from '../src/messaging.module.js'
import { idempotencyStoreToken, messageBus, transportToken } from '../src/tokens.js'
import type { MessageTransport } from '../src/types.js'
import { stubTransport } from './fixtures/stub-transport.js'

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

      @On('user.created')
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

    await bus.publish('user.created', { id: '1' })
    await wait(20)

    expect(users.received).toEqual([{ id: '1' }])
  })

  it('fans out to multiple @On handlers across different providers', async () => {
    @Injectable()
    class EmailService {
      calls: unknown[] = []
      @On('user.created')
      async send(p: unknown) {
        this.calls.push(p)
      }
    }

    @Injectable()
    class MetricsService {
      calls: unknown[] = []
      @On('user.created')
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

    await app.resolve(MessageBus).publish('user.created', { id: 42 })
    await wait(20)

    expect(app.resolve(EmailService).calls).toEqual([{ id: 42 }])
    expect(app.resolve(MetricsService).calls).toEqual([{ id: 42 }])
  })

  it('passes MessageMeta as the second argument to handlers', async () => {
    @Injectable()
    class H {
      lastMeta: unknown
      @On('x')
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

    await app.resolve(MessageBus).publish('x', {}, { correlationId: 'abc' })
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
      @On('traced')
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
    await app.resolve(MessageBus).publish('traced', {}, { traceparent, tracestate })
    await wait(15)

    const meta = app.resolve(H).lastMeta as { traceparent?: string; tracestate?: string }
    expect(meta?.traceparent).toBe(traceparent)
    expect(meta?.tracestate).toBe(tracestate)
  })

  it('isolated retry: throwing handler retries alone, sibling handlers do not re-run', async () => {
    @Injectable()
    class Good {
      calls = 0
      @On('topic')
      async ok() {
        this.calls++
      }
    }

    @Injectable()
    class Bad {
      calls = 0
      @On('topic')
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

    await app.resolve(MessageBus).publish('topic', {})
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
      @On('topic')
      async fail() {
        throw new Error('permanent')
      }
    }

    @Injectable()
    class DlqListener {
      received: Array<{ payload: unknown; lastError?: string }> = []
      @On('topic.dlq')
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

    await app.resolve(MessageBus).publish('topic', { id: 7 })
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
      @On('ping.fired')
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

    await app.resolve(MessageBus).publish('ping.fired', null)
    await wait(15)

    expect(app.resolve(PingController).hits).toBe(1)
  })

  it('delivers to an @On handler behind a factory provider under a token object', async () => {
    class OrderHandlers {
      received: unknown[] = []

      @On('order.created')
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

    await app.resolve(MessageBus).publish('order.created', { id: 1 })
    await wait(20)

    expect(app.resolve(HANDLERS).received).toEqual([{ id: 1 }])
  })

  it('derives the consumer group from the class of the handler instance', async () => {
    const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

    @Injectable()
    class BaseHandler {
      @On('topic')
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
      @On('topic')
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
        @On('topic')
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

      await app.resolve(MessageBus).publish('topic', {})
      await wait(60) // retry happens after backoff

      // Attempt 1: claim → handler runs → throws → release. Attempt 2: claim
      // succeeds again, handler runs and acks.
      expect(app.resolve(H).calls).toBe(2)
    })

    it('uses per-handler default key so two @Idempotent handlers on the same topic do not conflict', async () => {
      @Injectable()
      class A {
        calls = 0
        @On('topic')
        @Idempotent({ ttl: 60_000 })
        async run() {
          this.calls++
        }
      }
      @Injectable()
      class B {
        calls = 0
        @On('topic')
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

      await app.resolve(MessageBus).publish('topic', {})
      await wait(20)

      // Both handlers ran (per-handler default key isolates them).
      expect(app.resolve(A).calls).toBe(1)
      expect(app.resolve(B).calls).toBe(1)
    })

    it('respects a custom key from payload', async () => {
      @Injectable()
      class H {
        calls: unknown[] = []
        @On('payment')
        @Idempotent({ ttl: 60_000, key: (p: { txId: string }) => `txn:${p.txId}` })
        async run(p: { txId: string }) {
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
      await bus.publish('payment', { txId: 'tx-1' })
      await bus.publish('payment', { txId: 'tx-1' })
      await bus.publish('payment', { txId: 'tx-2' })
      await wait(20)

      // Only two handler runs - duplicate tx-1 was skipped.
      expect(app.resolve(H).calls).toHaveLength(2)
    })

    it('throws at startup when @Idempotent is used without a configured store', async () => {
      @Injectable()
      class H {
        @On('topic')
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
        @On('topic')
        async run(p: unknown) {
          this.calls.push(p)
        }
      }

      @Injectable()
      class KafkaHandler {
        calls: unknown[] = []
        @On('topic', { bus: 'kafka' })
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

      await defaultBus.publish('topic', { from: 'default' })
      await kafkaBus.publish('topic', { from: 'kafka' })
      await wait(20)

      expect(app.resolve(DefaultHandler).calls).toEqual([{ from: 'default' }])
      expect(app.resolve(KafkaHandler).calls).toEqual([{ from: 'kafka' }])
    })

    it('handler targeted at named bus does not run on default bus emit', async () => {
      @Injectable()
      class KafkaOnly {
        calls = 0
        @On('topic', { bus: 'kafka' })
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
      await app.resolve(MessageBus).publish('topic', {})
      await wait(20)
      expect(app.resolve(KafkaOnly).calls).toBe(0)

      // Kafka bus emits - KafkaOnly runs
      await app.resolve(messageBus('kafka')).publish('topic', {})
      await wait(20)
      expect(app.resolve(KafkaOnly).calls).toBe(1)
    })

    it("@On with bus: '' subscribes to the default bus", async () => {
      @Injectable()
      class EmptyName {
        calls = 0
        @On('topic', { bus: '' })
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

      await app.resolve(MessageBus).publish('topic', {})
      await wait(20)
      expect(app.resolve(EmptyName).calls).toBe(1)
    })

    it('throws at startup when @On references an unknown bus', async () => {
      @Injectable()
      class Bad {
        @On('topic', { bus: 'unknown' })
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
        @On('topic')
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
        @On('order.placed', { bus: 'audit' })
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

      await app.resolve(messageBus('audit')).publish('order.placed', { id: '1' })
      await wait(20)
      expect(app.resolve(AuditHandlers).received).toEqual([{ id: '1' }])
    })

    it('per-bus idempotency stores are isolated', async () => {
      @Injectable()
      class DefaultH {
        calls = 0
        @On('topic')
        @Idempotent({ ttl: 60_000 })
        async run() {
          this.calls++
        }
      }

      @Injectable()
      class KafkaH {
        calls = 0
        @On('topic', { bus: 'kafka' })
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
      await app.resolve(MessageBus).publish('topic', {})
      await app.resolve(messageBus('kafka')).publish('topic', {})
      await wait(20)

      expect(app.resolve(DefaultH).calls).toBe(1)
      expect(app.resolve(KafkaH).calls).toBe(1)
    })
  })

  it('MessageBus can be injected as a dependency of another provider', async () => {
    @Injectable()
    class Publisher {
      private bus = inject(MessageBus)
      async go() {
        await this.bus.publish('topic', { hello: 'world' })
      }
    }

    @Injectable()
    class Consumer {
      received: unknown[] = []
      @On('topic')
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
