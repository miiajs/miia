import { afterEach, describe, expect, it } from 'bun:test'
import { Injectable, Module } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { On } from '../src/decorators.js'
import { MessageBus } from '../src/message-bus.js'
import { IDEMPOTENCY_STORE } from '../src/idempotency.js'
import { inMemoryTransport } from '../src/in-memory-transport.js'
import { MessagingModule } from '../src/messaging.module.js'
import { getMessageBusToken } from '../src/tokens.js'
import { type InitialPositionKind, MESSAGE_TRANSPORT, type MessageTransport } from '../src/types.js'
import { stubTransport, StubTransport } from './fixtures/stub-transport.js'

const ALL_POSITIONS: readonly InitialPositionKind[] = ['latest', 'earliest', 'since']

function busProviders(transport: MessageTransport, options: ConstructorParameters<typeof MessageBus>[3] = {}) {
  return [
    { token: MESSAGE_TRANSPORT, factory: () => transport },
    { token: IDEMPOTENCY_STORE, factory: () => null },
    { token: MessageBus, factory: () => new MessageBus(transport, null, null, options) },
  ]
}

function fullStub(): StubTransport {
  return stubTransport({
    supportedModes: ['batch', 'sliding'],
    defaultMode: 'batch',
    supportedInitialPositions: ALL_POSITIONS,
  })
}

describe('Initial position', () => {
  let cleanup: Array<() => Promise<void>> = []

  afterEach(async () => {
    for (const fn of cleanup) await fn()
    cleanup = []
  })

  describe('resolution chain', () => {
    it("defaults to 'latest' when nothing sets it", async () => {
      const t = fullStub()

      @Injectable()
      class H {
        @On('topic')
        async run() {}
      }

      @Module({ providers: [H] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      cleanup.push(() => app.close())

      expect(t.subscribes).toHaveLength(1)
      expect(t.subscribes[0]?.options.initialPosition).toBe('latest')
    })

    it('bus default reaches a handler without its own, and a handler value overrides it', async () => {
      const t = fullStub()

      @Injectable()
      class Inherits {
        @On('topic')
        async run() {}
      }
      @Injectable()
      class Overrides {
        @On('topic', { initialPosition: 'earliest' })
        async run() {}
      }

      @Module({ providers: [Inherits, Overrides] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t, { initialPosition: { since: 1000 } }))
        .compile()
      cleanup.push(() => app.close())

      const byGroup = Object.fromEntries(t.subscribes.map((r) => [r.options.group, r.options.initialPosition]))
      expect(byGroup.topic__Inherits_run).toEqual({ since: 1000 })
      expect(byGroup.topic__Overrides_run).toBe('earliest')
    })
  })

  describe('broadcast', () => {
    it("bus default does not reach a broadcast handler - it gets 'latest'", async () => {
      const t = fullStub()

      @Injectable()
      class Cache {
        @On('cache.invalidate', { broadcast: true })
        async run() {}
      }

      @Module({ providers: [Cache] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t, { initialPosition: 'earliest' }))
        .compile()
      cleanup.push(() => app.close())

      expect(t.subscribes[0]?.options.broadcast).toBe(true)
      expect(t.subscribes[0]?.options.initialPosition).toBe('latest')
    })

    it("accepts an explicit 'latest' on a broadcast handler", async () => {
      const t = fullStub()

      @Injectable()
      class Cache {
        @On('cache.invalidate', { broadcast: true, initialPosition: 'latest' })
        async run() {}
      }

      @Module({ providers: [Cache] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      cleanup.push(() => app.close())

      expect(t.subscribes[0]?.options.initialPosition).toBe('latest')
    })

    it("throws when a broadcast handler asks for 'earliest'", async () => {
      const t = fullStub()

      @Injectable()
      class Cache {
        @On('cache.invalidate', { broadcast: true, initialPosition: 'earliest' })
        async run() {}
      }

      @Module({ providers: [Cache] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      await expect(promise).rejects.toThrow(/Cache\.run/)
      await expect(promise).rejects.toThrow(/broadcast handlers always start at 'latest'/)
      expect(t.subscribes).toHaveLength(0)
    })

    it('throws when a broadcast handler asks for a window', async () => {
      const t = fullStub()

      @Injectable()
      class Cache {
        @On('cache.invalidate', { broadcast: true, initialPosition: { since: 60_000 } })
        async run() {}
      }

      @Module({ providers: [Cache] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      await expect(promise).rejects.toThrow(/broadcast handlers always start at 'latest'/)
      await expect(promise).rejects.toThrow(/\{ since: 60000 \}/)
    })
  })

  describe('transport support', () => {
    it("a transport that does not declare it supports 'latest' only", async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })
      expect(t.supportedInitialPositions).toBeUndefined()

      @Injectable()
      class H {
        @On('topic', { initialPosition: 'earliest' })
        async run() {}
      }

      @Module({ providers: [H] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      await expect(promise).rejects.toThrow(/H\.run/)
      await expect(promise).rejects.toThrow(/StubTransport does not support/)
      await expect(promise).rejects.toThrow(/Supported: \['latest'\]/)
    })

    it("a transport that does not declare it accepts 'latest'", async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class Explicit {
        @On('topic', { initialPosition: 'latest' })
        async run() {}
      }
      @Injectable()
      class Implicit {
        @On('topic')
        async run() {}
      }

      @Module({ providers: [Explicit, Implicit] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      cleanup.push(() => app.close())

      expect(t.subscribes.map((r) => r.options.initialPosition)).toEqual(['latest', 'latest'])
    })

    it('throws when the transport does not declare the window form', async () => {
      const t = stubTransport({
        supportedModes: ['batch', 'sliding'],
        defaultMode: 'batch',
        supportedInitialPositions: ['latest', 'earliest'],
      })

      @Injectable()
      class H {
        @On('topic', { initialPosition: { since: 1000 } })
        async run() {}
      }

      @Module({ providers: [H] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      await expect(promise).rejects.toThrow(/H\.run/)
      await expect(promise).rejects.toThrow(/Supported: \['latest', 'earliest'\]/)
    })

    it('a bus default the transport does not support fails as what the handler resolves to', async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class H {
        @On('topic')
        async run() {}
      }

      @Module({ providers: [H] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t, { initialPosition: 'earliest' }))
        .compile()
      await expect(promise).rejects.toThrow(/H\.run/)
      await expect(promise).rejects.toThrow(/resolves to initialPosition 'earliest'/)
    })

    it('InMemoryTransport accepts every position', async () => {
      @Injectable()
      class H {
        @On('a', { initialPosition: 'latest' })
        async latest() {}

        @On('b', { initialPosition: 'earliest' })
        async earliest() {}

        @On('c', { initialPosition: { since: 60_000 } })
        async since() {}
      }

      @Module({
        imports: [MessagingModule.configure({ transport: inMemoryTransport({ drainTimeoutMs: 50 }) })],
        providers: [H],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      cleanup.push(() => app.close())
    })
  })

  describe('validation', () => {
    for (const since of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      it(`throws on a handler window of ${since}ms`, async () => {
        const t = fullStub()

        @Injectable()
        class H {
          @On('topic', { initialPosition: { since } })
          async run() {}
        }

        @Module({ providers: [H] })
        class AppModule {}

        const promise = TestApp.create(AppModule)
          .provide(...busProviders(t))
          .compile()
        await expect(promise).rejects.toThrow(/H\.run/)
        await expect(promise).rejects.toThrow(/which is invalid/)
        expect(t.subscribes).toHaveLength(0)
      })
    }

    it('throws on an invalid bus default even when only broadcast handlers would ignore it', async () => {
      const t = fullStub()

      @Injectable()
      class Cache {
        @On('cache.invalidate', { broadcast: true })
        async run() {}
      }

      @Module({ providers: [Cache] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t, { initialPosition: { since: 0 } }))
        .compile()
      await expect(promise).rejects.toThrow(/MessagingModule\.configure\(\{ initialPosition \}\)/)
      await expect(promise).rejects.toThrow(/which is invalid/)
    })

    it('throws when handlers sharing an explicit group resolve to different positions', async () => {
      const t = fullStub()

      @Injectable()
      class A {
        @On('jobs', { group: 'pool' })
        async run() {}
      }
      @Injectable()
      class B {
        @On('jobs', { group: 'pool', initialPosition: { since: 5000 } })
        async run() {}
      }

      @Module({ providers: [A, B] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      await expect(promise).rejects.toThrow(/share group 'pool' on topic 'jobs'/)
      await expect(promise).rejects.toThrow(/A\.run/)
      await expect(promise).rejects.toThrow(/B\.run/)
    })

    it('handlers sharing an explicit group with the same position subscribe normally', async () => {
      const t = fullStub()

      @Injectable()
      class A {
        @On('jobs', { group: 'pool', initialPosition: { since: 5000 } })
        async run() {}
      }
      @Injectable()
      class B {
        @On('jobs', { group: 'pool', initialPosition: { since: 5000 } })
        async run() {}
      }

      @Module({ providers: [A, B] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      cleanup.push(() => app.close())

      expect(t.subscribes).toHaveLength(2)
      expect(t.subscribes.every((r) => r.options.group === 'pool')).toBe(true)
    })
  })

  describe('module integration', () => {
    it('MessagingModule.configure forwards initialPosition to MessageBus', async () => {
      const t = fullStub()

      @Injectable()
      class H {
        @On('topic')
        async run() {}
      }

      @Module({
        imports: [MessagingModule.configure({ transport: t, initialPosition: { since: 30_000 } })],
        providers: [H],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      cleanup.push(() => app.close())

      expect(t.subscribes[0]?.options.initialPosition).toEqual({ since: 30_000 })
    })

    it("one bus's default does not reach another bus's handlers", async () => {
      const defaultTransport = fullStub()
      const namedTransport = fullStub()

      @Injectable()
      class OnDefault {
        @On('topic')
        async run() {}
      }
      @Injectable()
      class OnNamed {
        @On('topic', { bus: 'other' })
        async run() {}
      }

      @Module({
        imports: [
          MessagingModule.configure({ transport: defaultTransport, initialPosition: 'earliest' }),
          MessagingModule.configure({ transport: namedTransport }, 'other'),
        ],
        providers: [OnDefault, OnNamed],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      cleanup.push(() => app.close())

      expect(app.resolve<MessageBus>(getMessageBusToken('other') as string)).not.toBe(app.resolve(MessageBus))
      expect(defaultTransport.subscribes).toHaveLength(1)
      expect(defaultTransport.subscribes[0]?.options.initialPosition).toBe('earliest')
      expect(namedTransport.subscribes).toHaveLength(1)
      expect(namedTransport.subscribes[0]?.options.initialPosition).toBe('latest')
    })
  })
})
