import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { Injectable, inject, Module } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { On } from '../src/decorators.js'
import type { IdempotencyStore } from '../src/idempotency.js'
import { MessageBus } from '../src/message-bus.js'
import { InMemoryTransport, inMemoryTransport } from '../src/in-memory-transport.js'
import { MessagingModule } from '../src/messaging.module.js'
import { messageBus, transportToken } from '../src/tokens.js'
import type { Subscription } from '../src/types.js'

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('MessagingModule.configure', () => {
  let cleanup: Array<() => Promise<void>> = []

  afterEach(async () => {
    for (const fn of cleanup) await fn()
    cleanup = []
  })

  it('static options form registers MessageBus and transport', async () => {
    @Injectable()
    class H {
      received: unknown[] = []
      @On('topic')
      async on(p: unknown) {
        this.received.push(p)
      }
    }

    @Module({
      imports: [MessagingModule.configure({ transport: inMemoryTransport({ retry: { backoffMs: 5 } }) })],
      providers: [H],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).compile()
    cleanup.push(() => app.close())

    const bus = app.resolve(MessageBus)
    const transport = app.resolve(transportToken())
    expect(transport).toBeInstanceOf(InMemoryTransport)

    await bus.publish('topic', { ok: true })
    await wait(15)
    expect(app.resolve(H).received).toEqual([{ ok: true }])
  })

  it('factory form resolves dependencies from the container', async () => {
    class EnvConfig {
      getBackoff(): number {
        return 5
      }
    }

    @Injectable()
    class H {
      received: unknown[] = []
      @On('t')
      async on(p: unknown) {
        this.received.push(p)
      }
    }

    @Module({
      imports: [
        MessagingModule.configure((resolve) => {
          const cfg = resolve(EnvConfig)
          return { transport: inMemoryTransport({ retry: { backoffMs: cfg.getBackoff() } }) }
        }),
      ],
      providers: [EnvConfig, H],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).compile()
    cleanup.push(() => app.close())

    await app.resolve(MessageBus).publish('t', { n: 1 })
    await wait(15)
    expect(app.resolve(H).received).toEqual([{ n: 1 }])
  })

  it('MessageBus is a singleton - same instance across resolves', async () => {
    @Module({ imports: [MessagingModule.configure({ transport: inMemoryTransport() })] })
    class AppModule {}

    const app = await TestApp.create(AppModule).compile()
    cleanup.push(() => app.close())

    const a = app.resolve(MessageBus)
    const b = app.resolve(MessageBus)
    expect(a).toBe(b)
  })

  it('works end-to-end via MessageBus injected by another provider', async () => {
    @Injectable()
    class Publisher {
      constructor() {}
    }

    @Injectable()
    class OrderHandlers {
      received: unknown[] = []
      @On('order.placed')
      async on(payload: unknown) {
        this.received.push(payload)
      }
    }

    @Module({
      imports: [MessagingModule.configure({ transport: inMemoryTransport({ retry: { backoffMs: 5 } }) })],
      providers: [Publisher, OrderHandlers],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).compile()
    cleanup.push(() => app.close())

    await app.resolve(MessageBus).publish('order.placed', { orderId: 'xyz' })
    await wait(15)

    expect(app.resolve(OrderHandlers).received).toEqual([{ orderId: 'xyz' }])
  })

  it('throws when the same bus name is configured twice', async () => {
    @Module({
      imports: [
        MessagingModule.configure({ transport: inMemoryTransport() }, { name: 'kafka' }),
        MessagingModule.configure({ transport: inMemoryTransport() }, { name: 'kafka' }),
      ],
    })
    class AppModule {}

    await expect(TestApp.create(AppModule).compile()).rejects.toThrow(/configured twice/)
  })

  it('TestApp.override replaces the transport of a named bus and leaves the default bus alone', async () => {
    const defaultTransport = inMemoryTransport()
    const replacement = inMemoryTransport({ retry: { backoffMs: 5 } })

    @Injectable()
    class KafkaHandler {
      received: unknown[] = []
      @On('topic', { bus: 'kafka' })
      async on(p: unknown) {
        this.received.push(p)
      }
    }

    @Module({
      imports: [
        MessagingModule.configure({ transport: defaultTransport }),
        MessagingModule.configure({ transport: inMemoryTransport() }, { name: 'kafka' }),
      ],
      providers: [KafkaHandler],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .override(MessagingModule, MessagingModule.configure({ transport: replacement }, { name: 'kafka' }))
      .compile()
    cleanup.push(() => app.close())

    expect(app.resolve(transportToken('kafka'))).toBe(replacement)
    expect(app.resolve(transportToken())).toBe(defaultTransport)

    await app.resolve(messageBus('kafka')).publish('topic', { n: 1 })
    await wait(15)
    expect(app.resolve(KafkaHandler).received).toEqual([{ n: 1 }])
  })

  it('inject(messageBus(name)) without that bus names the configure() call that provides it', async () => {
    @Injectable()
    class Publisher {
      bus = inject(messageBus('kafka'))
    }

    @Module({ imports: [MessagingModule.configure({ transport: inMemoryTransport() })], providers: [Publisher] })
    class AppModule {}

    await expect(TestApp.create(AppModule).compile()).rejects.toThrow(
      /No provider found for token: MessageBus\(kafka\)[\s\S]*is provided by MessagingModule\.configure\(opts, \{ name: 'kafka' \}\)/,
    )
  })

  it('messageBus() returns one token per name and rejects an empty name', () => {
    expect(messageBus('kafka')).toBe(messageBus('kafka'))
    expect(() => messageBus('')).toThrow(TypeError)
  })
})

describe('MessagingModule shutdown', () => {
  class Store implements IdempotencyStore {
    async claim(): Promise<boolean> {
      return true
    }
    async release(): Promise<void> {}
    async onDestroy(): Promise<void> {}
  }

  it('lets @On handlers finish before an unrelated provider registered after the bus closes its resources', async () => {
    const events: string[] = []

    @Injectable()
    class SlowHandler {
      @On('job')
      async on() {
        events.push('handler started')
        await wait(50)
        events.push('handler finished')
      }
    }

    @Injectable()
    class Db {
      async onDestroy() {
        events.push('db closed')
      }
    }

    // Root providers register after the imports, so reverse order alone would close Db before the drain.
    @Module({
      imports: [MessagingModule.configure({ transport: inMemoryTransport({ drainTimeoutMs: 1000 }) })],
      providers: [SlowHandler, Db],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).compile()
    await app.resolve(MessageBus).publish('job', {})
    await wait(5)
    expect(events).toEqual(['handler started'])

    await app.close()
    expect(events).toEqual(['handler started', 'handler finished', 'db closed'])
  })

  it('shuts down the bus before the transport, and closes the store before the transport', async () => {
    const transport = new InMemoryTransport()
    const store = new Store()

    @Injectable()
    class H {
      @On('topic')
      async on() {}
    }

    @Module({ imports: [MessagingModule.configure({ transport, idempotency: store })], providers: [H] })
    class AppModule {}

    const subscribe = spyOn(transport, 'subscribe')
    const app = await TestApp.create(AppModule).compile()
    const unsubscribe = spyOn(await (subscribe.mock.results[0]!.value as Promise<Subscription>), 'unsubscribe')
    const busShutdown = spyOn(app.resolve(MessageBus), 'onShutdown')
    const transportShutdown = spyOn(transport, 'onShutdown')
    const storeDestroy = spyOn(store, 'onDestroy')
    const transportDestroy = spyOn(transport, 'onDestroy')

    await app.close()

    // First calls: the transport's onDestroy() calls its own onShutdown() again.
    const first = (spy: { mock: { invocationCallOrder: number[] } }) => spy.mock.invocationCallOrder[0] ?? Number.NaN
    expect(first(busShutdown)).toBeLessThan(first(transportShutdown))
    expect(first(unsubscribe)).toBeLessThan(first(transportShutdown))
    expect(first(transportShutdown)).toBeLessThan(first(storeDestroy))
    expect(first(storeDestroy)).toBeLessThan(first(transportDestroy))
  })

  it('closes an idempotency store shared by two buses once', async () => {
    const store = new Store()
    const storeDestroy = spyOn(store, 'onDestroy')

    @Module({
      imports: [
        MessagingModule.configure({ transport: inMemoryTransport(), idempotency: store }),
        MessagingModule.configure({ transport: inMemoryTransport(), idempotency: store }, { name: 'second' }),
      ],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).compile()
    await app.close()

    expect(storeDestroy).toHaveBeenCalledTimes(1)
  })
})
