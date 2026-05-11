import { afterEach, describe, expect, it } from 'bun:test'
import { Injectable, Module } from '@miiajs/core'
import { TestApp } from '@miiajs/core/testing'
import { On } from '../src/decorators.js'
import { MessageBus } from '../src/message-bus.js'
import { InMemoryTransport, inMemoryTransport } from '../src/in-memory-transport.js'
import { MessagingModule } from '../src/messaging.module.js'
import { MESSAGE_TRANSPORT, type MessageTransport } from '../src/types.js'

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
    const transport = app.resolve<MessageTransport>(MESSAGE_TRANSPORT)
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
})
