import { afterEach, describe, expect, it } from 'bun:test'
import { Injectable, Module } from '@miiajs/core'
import { TestApp } from '@miiajs/core/testing'
import { On } from '../src/decorators.js'
import { MessageBus } from '../src/message-bus.js'
import { IDEMPOTENCY_STORE } from '../src/idempotency.js'
import { inMemoryTransport } from '../src/in-memory-transport.js'
import { MessagingModule } from '../src/messaging.module.js'
import { MESSAGE_TRANSPORT, type MessageTransport } from '../src/types.js'
import { stubTransport, StubTransport } from './fixtures/stub-transport.js'

function busProviders(
  transport: MessageTransport,
  options: { dispatch?: { mode?: 'batch' | 'sliding'; concurrency?: number } | null; appName?: string | null } = {},
) {
  return [
    { token: MESSAGE_TRANSPORT, factory: () => transport },
    { token: IDEMPOTENCY_STORE, factory: () => null },
    { token: MessageBus, factory: () => new MessageBus(transport, null, null, options) },
  ]
}

describe('Dispatch modes', () => {
  let cleanup: Array<() => Promise<void>> = []

  afterEach(async () => {
    for (const fn of cleanup) await fn()
    cleanup = []
  })

  describe('resolution chain', () => {
    it('subscription mode overrides bus default and transport default', async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class H {
        @On('topic', { mode: 'sliding', concurrency: 8 })
        async run() {}
      }

      @Module({ providers: [H] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t, { dispatch: { mode: 'batch', concurrency: 2 } }))
        .compile()
      cleanup.push(() => app.close())

      expect(t.subscribes).toHaveLength(1)
      expect(t.subscribes[0]?.options.mode).toBe('sliding')
      expect(t.subscribes[0]?.options.concurrency).toBe(8)
    })

    it('bus default applies when subscription has no explicit mode/concurrency', async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class H {
        @On('topic')
        async run() {}
      }

      @Module({ providers: [H] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t, { dispatch: { mode: 'sliding', concurrency: 4 } }))
        .compile()
      cleanup.push(() => app.close())

      expect(t.subscribes[0]?.options.mode).toBe('sliding')
      expect(t.subscribes[0]?.options.concurrency).toBe(4)
    })

    it('transport default applies when neither bus nor subscription set mode', async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

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

      expect(t.subscribes[0]?.options.mode).toBe('batch')
      // No bus default, no subscription override → falls back to 1.
      expect(t.subscribes[0]?.options.concurrency).toBe(1)
    })
  })

  describe('validation', () => {
    it('throws when handler requests a mode the transport does not support', async () => {
      const t = stubTransport({ supportedModes: ['sliding'], defaultMode: 'sliding' })

      @Injectable()
      class H {
        @On('topic', { mode: 'batch' })
        async run() {}
      }

      @Module({ providers: [H] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      // Error message must reference handler ref, requested mode, supported list, transport name.
      await expect(promise).rejects.toThrow(/H\.run/)
      await expect(promise).rejects.toThrow(/'batch'/)
      await expect(promise).rejects.toThrow(/'sliding'/)
      await expect(promise).rejects.toThrow(/StubTransport/)
    })

    it('throws when concurrency resolves to 0', async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class H {
        @On('topic', { concurrency: 0 })
        async run() {}
      }

      @Module({ providers: [H] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      await expect(promise).rejects.toThrow(/H\.run/)
      await expect(promise).rejects.toThrow(/concurrency=0/)
    })

    it('handlers with different mode/concurrency on the same topic each get their own subscription', async () => {
      // Used to be a bucket-conflict throw; in handler-per-subscription model
      // each @On is its own subscription with its own configuration. No
      // conflict possible by construction.
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class A {
        @On('topic', { mode: 'batch', concurrency: 4 })
        async run() {}
      }
      @Injectable()
      class B {
        @On('topic', { mode: 'sliding', concurrency: 8 })
        async run() {}
      }

      @Module({ providers: [A, B] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      cleanup.push(() => app.close())

      expect(t.subscribes).toHaveLength(2)
      const byMode = Object.fromEntries(t.subscribes.map((r) => [r.options.mode, r.options.concurrency]))
      expect(byMode.batch).toBe(4)
      expect(byMode.sliding).toBe(8)
    })
  })

  describe('module integration', () => {
    it('MessagingModule.configure forwards dispatch defaults to MessageBus', async () => {
      const t = new StubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class H {
        @On('topic')
        async run() {}
      }

      @Module({
        imports: [MessagingModule.configure({ transport: t, dispatch: { mode: 'sliding', concurrency: 6 } })],
        providers: [H],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      cleanup.push(() => app.close())

      expect(t.subscribes[0]?.options.mode).toBe('sliding')
      expect(t.subscribes[0]?.options.concurrency).toBe(6)
    })

    it('handlers requesting batch against in-memory transport throw at startup', async () => {
      @Injectable()
      class H {
        @On('topic', { mode: 'batch' })
        async run() {}
      }

      @Module({
        imports: [MessagingModule.configure({ transport: inMemoryTransport({ drainTimeoutMs: 50 }) })],
        providers: [H],
      })
      class AppModule {}

      const promise = TestApp.create(AppModule).compile()
      await expect(promise).rejects.toThrow(/'batch'/)
      await expect(promise).rejects.toThrow(/InMemoryTransport/)
    })
  })

  describe('handler-per-subscription model', () => {
    it('each @On creates its own transport.subscribe call', async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class A {
        @On('topic')
        async run() {}
      }
      @Injectable()
      class B {
        @On('topic')
        async run() {}
      }
      @Injectable()
      class C {
        @On('other')
        async run() {}
      }

      @Module({ providers: [A, B, C] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      cleanup.push(() => app.close())

      // 3 handlers → 3 separate subscriptions, each with its own auto-derived group.
      expect(t.subscribes).toHaveLength(3)
      const groups = t.subscribes.map((r) => r.options.group).sort()
      expect(groups).toEqual(['other__C_run', 'topic__A_run', 'topic__B_run'])
    })

    it('multi-topic handler creates one subscription per @On decoration', async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class Sync {
        @On('user.created')
        @On('user.updated')
        async run() {}
      }

      @Module({ providers: [Sync] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      cleanup.push(() => app.close())

      expect(t.subscribes).toHaveLength(2)
      const topics = t.subscribes.map((r) => r.topic).sort()
      expect(topics).toEqual(['user.created', 'user.updated'])
    })

    it('appName prefixes auto-derived groups but not explicit groups', async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class Auto {
        @On('topic')
        async run() {}
      }
      @Injectable()
      class Explicit {
        @On('topic', { group: 'my-pool' })
        async run() {}
      }

      @Module({ providers: [Auto, Explicit] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t, { appName: 'svc' }))
        .compile()
      cleanup.push(() => app.close())

      const groups = t.subscribes.map((r) => r.options.group).sort()
      expect(groups).toEqual(['my-pool', 'svc:topic__Auto_run'])
    })

    it('broadcast option appends hostname/pid to group and sets broadcast flag', async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class Cache {
        @On('cache.invalidate', { broadcast: true })
        async run() {}
      }

      @Module({ providers: [Cache] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      cleanup.push(() => app.close())

      const opt = t.subscribes[0]?.options
      expect(opt?.broadcast).toBe(true)
      expect(opt?.group).toMatch(/^cache\.invalidate__Cache_run__.+_\d+$/)
    })

    it('broadcast + group throws at onReady (mutually exclusive)', async () => {
      const t = stubTransport({ supportedModes: ['batch', 'sliding'], defaultMode: 'batch' })

      @Injectable()
      class Bad {
        @On('topic', { broadcast: true, group: 'workers' })
        async run() {}
      }

      @Module({ providers: [Bad] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      await expect(promise).rejects.toThrow(/broadcast and group are mutually exclusive/)
      await expect(promise).rejects.toThrow(/Bad\.run/)
    })

    it('explicit group on transport without supportsCompetingConsumers throws at onReady', async () => {
      const t = stubTransport({
        supportedModes: ['sliding'],
        defaultMode: 'sliding',
        supportsCompetingConsumers: false,
      })

      @Injectable()
      class Worker {
        @On('jobs', { group: 'pool' })
        async run() {}
      }

      @Module({ providers: [Worker] })
      class AppModule {}

      const promise = TestApp.create(AppModule)
        .provide(...busProviders(t))
        .compile()
      await expect(promise).rejects.toThrow(/does not support competing consumers/)
      await expect(promise).rejects.toThrow(/Worker\.run/)
    })

    it('isolated retry: throwing handler retries alone, sibling handlers not re-run', async () => {
      // Use real in-memory transport for this test - we need actual retry mechanics.
      const transport = inMemoryTransport({ retry: { backoffMs: 5, maxAttempts: 3 }, drainTimeoutMs: 100 })

      @Injectable()
      class Sibling {
        runs = 0
        @On('topic')
        async run() {
          this.runs++
        }
      }

      @Injectable()
      class Throwing {
        runs = 0
        @On('topic')
        async run() {
          this.runs++
          if (this.runs < 2) throw new Error('transient')
        }
      }

      @Module({ providers: [Sibling, Throwing] })
      class AppModule {}

      const app = await TestApp.create(AppModule)
        .provide(...busProviders(transport))
        .compile()
      cleanup.push(() => app.close())

      await app.resolve(MessageBus).publish('topic', {})
      await new Promise((r) => setTimeout(r, 60))

      // Sibling success on attempt 1, never retried.
      expect(app.resolve(Sibling).runs).toBe(1)
      // Throwing throws on attempt 1 → retry → success on attempt 2.
      expect(app.resolve(Throwing).runs).toBe(2)
    })

    it('broadcast + @Idempotent without explicit key throws at onReady', async () => {
      const { Idempotent } = await import('../src/decorators.js')
      const { memoryIdempotencyStore } = await import('../src/idempotency.js')
      const store = memoryIdempotencyStore()

      @Injectable()
      class Bad {
        @On('topic', { broadcast: true })
        @Idempotent({ ttl: 60_000 })
        async run() {}
      }

      @Module({
        imports: [
          MessagingModule.configure({
            transport: inMemoryTransport({ drainTimeoutMs: 50 }),
            idempotency: store,
          }),
        ],
        providers: [Bad],
      })
      class AppModule {}

      const promise = TestApp.create(AppModule).compile()
      await expect(promise).rejects.toThrow(/combines broadcast: true with @Idempotent/)
      await expect(promise).rejects.toThrow(/Bad\.run/)
    })

    it('broadcast + @Idempotent with explicit key passes onReady', async () => {
      const { Idempotent } = await import('../src/decorators.js')
      const { memoryIdempotencyStore } = await import('../src/idempotency.js')
      const store = memoryIdempotencyStore()

      @Injectable()
      class Ok {
        @On('topic', { broadcast: true })
        @Idempotent({ ttl: 60_000, key: (_, m) => `topic:${m.timestamp}:${process.pid}` })
        async run() {}
      }

      @Module({
        imports: [
          MessagingModule.configure({
            transport: inMemoryTransport({ drainTimeoutMs: 50 }),
            idempotency: store,
          }),
        ],
        providers: [Ok],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      cleanup.push(() => app.close())
      // No throw == passes
    })
  })
})
