import { describe, expect, it } from 'bun:test'
import type { CanActivate, Resolve } from '../src/index.js'
import { createToken, inject, Injectable, Miia, Module, overrideProvider, provider, Resolver } from '../src/index.js'

function hooks(events: string[], name: string) {
  return {
    onInit() {
      events.push(`${name}.onInit`)
    },
    onReady() {
      events.push(`${name}.onReady`)
    },
  }
}

function tracked(events: string[], name: string) {
  return class {
    onInit() {
      events.push(`${name}.onInit`)
    }
    onReady() {
      events.push(`${name}.onReady`)
    }
  }
}

async function initError(app: Miia): Promise<Error> {
  try {
    await app.init()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected init() to reject')
}

describe('hook order', () => {
  it('runs the hooks of an injected provider first, whatever the module order', async () => {
    const events: string[] = []

    @Injectable()
    class UsersService extends tracked(events, 'Users') {}

    @Injectable()
    class OrdersService extends tracked(events, 'Orders') {
      users = inject(UsersService)
    }

    @Module({ global: true, providers: [UsersService], exports: [UsersService] })
    class UsersModule {}

    @Module({ providers: [OrdersService] })
    class OrdersModule {}

    @Module({ imports: [OrdersModule, UsersModule] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    expect(events).toEqual(['Users.onInit', 'Orders.onInit', 'Users.onReady', 'Orders.onReady'])
    await app.destroy()
  })

  it('keeps registration order for unrelated providers', async () => {
    const events: string[] = []

    @Injectable()
    class Charlie extends tracked(events, 'Charlie') {}

    @Injectable()
    class Alpha extends tracked(events, 'Alpha') {}

    @Injectable()
    class Bravo extends tracked(events, 'Bravo') {}

    @Module({ providers: [Charlie, Alpha, Bravo] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    expect(events).toEqual([
      'Charlie.onInit',
      'Alpha.onInit',
      'Bravo.onInit',
      'Charlie.onReady',
      'Alpha.onReady',
      'Bravo.onReady',
    ])
    await app.destroy()
  })

  it('follows an edge through a transient provider', async () => {
    const events: string[] = []
    const A = createToken<object>('A')
    const T = createToken<object>('T')
    const B = createToken<object>('B')

    const app = new Miia({ logger: false }).provide(
      provider(A, (resolve) => {
        resolve(T)
        return hooks(events, 'A')
      }),
      provider(T, (resolve) => ({ b: resolve(B) }), { scope: 'transient' }),
      provider(B, () => hooks(events, 'B')),
    )
    await app.init()
    expect(events).toEqual(['B.onInit', 'A.onInit', 'B.onReady', 'A.onReady'])
    await app.destroy()
  })

  it('records an edge to a singleton that was already built', async () => {
    const events: string[] = []

    @Injectable()
    class B extends tracked(events, 'B') {}

    @Injectable()
    class A extends tracked(events, 'A') {
      b = inject(B)
    }

    @Module({ providers: [A, B] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    app.get(B)
    await app.init()
    expect(events).toEqual(['B.onInit', 'A.onInit', 'B.onReady', 'A.onReady'])
    await app.destroy()
  })

  it('records an edge for Resolver.resolve() in a field initializer', async () => {
    const events: string[] = []

    @Injectable()
    class B extends tracked(events, 'B') {}

    @Injectable()
    class A extends tracked(events, 'A') {
      b = inject(Resolver).resolve(B)
    }

    @Module({ providers: [A, B] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    expect(events).toEqual(['B.onInit', 'A.onInit', 'B.onReady', 'A.onReady'])
    await app.destroy()
  })

  it('gets each hook to an instance registered under two tokens once', async () => {
    const events: string[] = []
    const T1 = createToken<object>('T1')
    const T2 = createToken<object>('T2')

    const app = new Miia({ logger: false }).provide(
      provider(T1, () => hooks(events, 'Shared')),
      provider(T2, (resolve) => resolve(T1)),
    )
    await app.init()
    expect(app.get(T2)).toBe(app.get(T1))
    expect(events).toEqual(['Shared.onInit', 'Shared.onReady'])
    await app.destroy()
  })

  it('calls onInit() on a function instance', async () => {
    const events: string[] = []
    const FN = createToken<() => string>('Fn')

    const app = new Miia({ logger: false }).provide(
      provider(FN, () => Object.assign(() => 'fn', { onInit: () => events.push('Fn.onInit') })),
    )
    await app.init()
    expect(events).toEqual(['Fn.onInit'])
    await app.destroy()
  })

  it('does not see a cycle when a factory catches a failed resolve', async () => {
    const events: string[] = []
    const A = createToken<object>('A')

    @Injectable()
    class B extends tracked(events, 'B') {
      a = inject(A)
    }

    const app = new Miia({ logger: false }).provide(
      provider(A, (resolve) => {
        try {
          return resolve(B)
        } catch {
          return hooks(events, 'A')
        }
      }),
      B,
    )
    await app.init()
    expect(events).toEqual(['A.onInit', 'B.onInit', 'A.onReady', 'B.onReady'])
    await app.destroy()
  })
})

describe('deps', () => {
  const LAZY = createToken<object>('Lazy')

  function lazyApp(events: string[], withDeps: boolean) {
    // Resolves the service only from its own onInit(), after construction: the container cannot see it.
    const lazy = (resolve: Resolve) => ({
      onInit() {
        resolve(Service)
        events.push('Lazy.onInit')
      },
    })

    @Injectable()
    class Service extends tracked(events, 'Service') {}

    @Module({ providers: [provider(LAZY, lazy, { deps: withDeps ? [Service] : undefined }), Service] })
    class AppModule {}

    return new Miia({ logger: false }).register(AppModule)
  }

  it('runs the hooks of a deps entry first', async () => {
    const events: string[] = []
    const app = lazyApp(events, true)
    await app.init()
    expect(events).toEqual(['Service.onInit', 'Lazy.onInit', 'Service.onReady'])
    await app.destroy()
  })

  it('keeps registration order without deps', async () => {
    const events: string[] = []
    const app = lazyApp(events, false)
    await app.init()
    expect(events).toEqual(['Lazy.onInit', 'Service.onInit', 'Service.onReady'])
    await app.destroy()
  })

  it('takes deps from provider() and from a plain factory provider in app.provide()', async () => {
    const events: string[] = []
    const VIA_HELPER = createToken<object>('ViaHelper')
    const VIA_OBJECT = createToken<object>('ViaObject')

    @Injectable()
    class Service extends tracked(events, 'Service') {}

    const app = new Miia({ logger: false }).provide(
      provider(VIA_HELPER, () => hooks(events, 'ViaHelper'), { deps: [Service] }),
      { token: VIA_OBJECT, factory: () => hooks(events, 'ViaObject'), deps: [Service] },
      Service,
    )
    await app.init()
    expect(events.slice(0, 3)).toEqual(['Service.onInit', 'ViaHelper.onInit', 'ViaObject.onInit'])
    await app.destroy()
  })

  it('rejects an unregistered token in deps before any onInit()', async () => {
    const events: string[] = []
    const MISSING = createToken<object>('Missing')

    @Injectable()
    class Service extends tracked(events, 'Service') {}

    const app = new Miia({ logger: false }).provide(
      Service,
      provider(LAZY, () => hooks(events, 'Lazy'), { deps: [MISSING] }),
    )
    const error = await initError(app)
    expect(error.message.split('\n')[0]).toBe('[Miia] No provider found for token: Missing, required by deps of Lazy')
    expect(events).toEqual([])
  })

  it('rejects an unregistered token in deps of a transient provider', async () => {
    const events: string[] = []
    const MISSING = createToken<object>('Missing')
    const TRANSIENT = createToken<object>('Transient')

    @Injectable()
    class Service extends tracked(events, 'Service') {}

    const app = new Miia({ logger: false }).provide(
      Service,
      provider(TRANSIENT, () => ({}), { scope: 'transient', deps: [MISSING] }),
    )
    const error = await initError(app)
    expect(error.message.split('\n')[0]).toBe(
      '[Miia] No provider found for token: Missing, required by deps of Transient',
    )
    expect(events).toEqual([])
  })

  it('rejects a cycle that exists only through deps', async () => {
    const events: string[] = []
    const A = createToken<object>('A')

    @Injectable()
    class B extends tracked(events, 'B') {
      a = inject(A)
    }

    const app = new Miia({ logger: false }).provide(
      provider(A, () => hooks(events, 'A'), { deps: [B] }),
      B,
    )
    const error = await initError(app)
    expect(error.message).toBe(
      '[Miia] Circular dependency detected: A -> B -> A\n' +
        '  - deps of A lists B: drop that entry, or move the shared logic into a provider both depend on',
    )
    expect(events).toEqual([])
  })

  it('drops the deps of an overridden provider', async () => {
    const MISSING = createToken<object>('Missing')

    @Module({ providers: [provider(LAZY, () => ({}), { deps: [MISSING] })] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(
      AppModule,
      overrideProvider(LAZY, () => ({ fake: true })),
    )
    await app.init()
    expect(app.get(LAZY)).toEqual({ fake: true })
    await app.destroy()
  })
})

describe('global guards', () => {
  it('builds an undeclared global guard before onInit() and calls its hooks once', async () => {
    const events: string[] = []

    class GlobalGuard extends tracked(events, 'Guard') implements CanActivate {
      canActivate() {
        return true
      }
    }

    @Injectable()
    class Service extends tracked(events, 'Service') {}

    @Module({ providers: [Service] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule).useGuard(GlobalGuard)
    await app.init()
    expect(events).toEqual(['Service.onInit', 'Guard.onInit', 'Service.onReady', 'Guard.onReady'])
    await app.destroy()
  })

  it('calls onInit() once on a global guard that is also declared in providers', async () => {
    const events: string[] = []

    class GlobalGuard extends tracked(events, 'Guard') implements CanActivate {
      canActivate() {
        return true
      }
    }

    @Module({ providers: [GlobalGuard], exports: [GlobalGuard] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule).useGuard(GlobalGuard)
    await app.init()
    expect(events).toEqual(['Guard.onInit', 'Guard.onReady'])
    await app.destroy()
  })

  it('rejects init() before any onInit() when a global guard constructor throws', async () => {
    const events: string[] = []

    class BrokenGuard implements CanActivate {
      constructor() {
        throw new Error('BrokenGuard used without configuration')
      }
      canActivate() {
        return true
      }
    }

    @Injectable()
    class Service extends tracked(events, 'Service') {}

    @Module({ providers: [Service] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule).useGuard(BrokenGuard)
    const error = await initError(app)
    expect(error.message).toBe('BrokenGuard used without configuration')
    expect(events).toEqual([])
  })
})
