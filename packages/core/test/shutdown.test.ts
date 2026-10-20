import { describe, expect, it } from 'bun:test'
import type { LoggerService } from '../src/index.js'
import { Controller, createToken, inject, Injectable, Miia, Module, provider } from '../src/index.js'

function hooks(events: string[], name: string) {
  return {
    onShutdown() {
      events.push(`${name}.onShutdown`)
    },
    onDestroy() {
      events.push(`${name}.onDestroy`)
    },
  }
}

function tracked(events: string[], name: string) {
  return class {
    onShutdown() {
      events.push(`${name}.onShutdown`)
    }
    onDestroy() {
      events.push(`${name}.onDestroy`)
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

async function destroyError(app: Miia): Promise<unknown> {
  try {
    await app.destroy()
  } catch (err) {
    return err
  }
  throw new Error('expected destroy() to reject')
}

describe('shutdown order', () => {
  it('runs onShutdown() on every provider before onDestroy() on any', async () => {
    const events: string[] = []

    @Injectable()
    class Alpha extends tracked(events, 'Alpha') {}

    @Injectable()
    class Bravo extends tracked(events, 'Bravo') {}

    const app = new Miia({ logger: false }).provide(Alpha, Bravo)
    await app.init()
    await app.destroy()
    expect(events.slice(0, 2).every((e) => e.endsWith('.onShutdown'))).toBe(true)
    expect(events.slice(2).every((e) => e.endsWith('.onDestroy'))).toBe(true)
    expect(events).toHaveLength(4)
  })

  it('runs both phases in reverse dependency order, whatever the module order', async () => {
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
    await app.destroy()
    expect(events).toEqual(['Orders.onShutdown', 'Users.onShutdown', 'Orders.onDestroy', 'Users.onDestroy'])
  })

  it('runs unrelated providers in reverse registration order', async () => {
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
    await app.destroy()
    expect(events).toEqual([
      'Bravo.onShutdown',
      'Alpha.onShutdown',
      'Charlie.onShutdown',
      'Bravo.onDestroy',
      'Alpha.onDestroy',
      'Charlie.onDestroy',
    ])
  })

  it('closes an unrelated resource only after a slow onShutdown() has finished', async () => {
    const events: string[] = []

    @Injectable()
    class Consumer {
      async onShutdown() {
        events.push('Consumer.onShutdown:start')
        await new Promise((r) => setTimeout(r, 40))
        events.push('Consumer.onShutdown:end')
      }
    }

    @Injectable()
    class Resource {
      onDestroy() {
        events.push('Resource.onDestroy')
      }
    }

    @Module({ providers: [Consumer, Resource] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    await app.destroy()
    expect(events).toEqual(['Consumer.onShutdown:start', 'Consumer.onShutdown:end', 'Resource.onDestroy'])
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
    await app.destroy()
    expect(events).toEqual(['Shared.onShutdown', 'Shared.onDestroy'])
  })

  it('runs one shutdown for concurrent destroy() calls; a later call runs its own', async () => {
    const events: string[] = []
    const logged: string[] = []
    const logger: LoggerService = {
      log(message) {
        logged.push(message)
      },
      warn() {},
      error() {},
    }

    @Injectable()
    class Service extends tracked(events, 'Service') {}

    const app = new Miia({ logger }).provide(Service)
    await app.init()
    await Promise.all([app.destroy(), app.destroy()])
    expect(events).toEqual(['Service.onShutdown', 'Service.onDestroy'])
    expect(logged.filter((message) => message === 'Shutdown complete')).toHaveLength(1)

    await app.destroy()
    expect(logged.filter((message) => message === 'Shutdown complete')).toHaveLength(2)
  })
})

describe('shutdown failures', () => {
  it('runs the remaining onDestroy() hooks and rethrows a single failure as is', async () => {
    const events: string[] = []
    const failure = new Error('disconnect failed')

    @Injectable()
    class First extends tracked(events, 'First') {}

    @Injectable()
    class Failing {
      onDestroy() {
        throw failure
      }
    }

    @Injectable()
    class Last extends tracked(events, 'Last') {}

    const app = new Miia({ logger: false }).provide(First, Failing, Last)
    await app.init()
    expect(await destroyError(app)).toBe(failure)
    expect(events).toEqual(['Last.onShutdown', 'First.onShutdown', 'Last.onDestroy', 'First.onDestroy'])
  })

  it('still calls onDestroy() of a provider whose onShutdown() threw', async () => {
    const events: string[] = []
    const failure = new Error('drain failed')

    @Injectable()
    class Worker {
      onShutdown() {
        throw failure
      }
      onDestroy() {
        events.push('Worker.onDestroy')
      }
    }

    const app = new Miia({ logger: false }).provide(Worker)
    await app.init()
    expect(await destroyError(app)).toBe(failure)
    expect(events).toEqual(['Worker.onDestroy'])
  })

  it('throws an AggregateError with every failure in the order they happened', async () => {
    const destroyFailure = new Error('destroy failed')
    const shutdownFailure = new Error('shutdown failed')

    @Injectable()
    class Store {
      onDestroy() {
        throw destroyFailure
      }
    }

    @Injectable()
    class Bus {
      onShutdown() {
        throw shutdownFailure
      }
    }

    const app = new Miia({ logger: false }).provide(Store, Bus)
    await app.init()
    const error = await destroyError(app)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).message).toBe('[Miia] Shutdown finished with 2 errors')
    expect((error as AggregateError).errors).toEqual([shutdownFailure, destroyFailure])
  })

  it('runs the hooks when closing the server throws, then rethrows the close error', async () => {
    const events: string[] = []
    const closeFailure = new Error('close exploded')

    @Injectable()
    class Service extends tracked(events, 'Service') {}

    const app = new Miia({ logger: false, shutdownHooks: false }).provide(Service)
    await app.listen(5100, () => ({
      close() {
        throw closeFailure
      },
    }))
    expect(await destroyError(app)).toBe(closeFailure)
    expect(events).toEqual(['Service.onShutdown', 'Service.onDestroy'])
  })

  it('runs nothing on a second destroy() after one that threw', async () => {
    const events: string[] = []
    let closes = 0

    @Injectable()
    class Failing {
      onShutdown() {
        events.push('Failing.onShutdown')
      }
      onDestroy() {
        throw new Error('disconnect failed')
      }
    }

    const app = new Miia({ logger: false, shutdownHooks: false }).provide(Failing)
    await app.listen(5101, () => ({
      close() {
        closes++
      },
    }))
    await destroyError(app)
    expect(events).toEqual(['Failing.onShutdown'])

    await app.destroy()
    expect(events).toEqual(['Failing.onShutdown'])
    expect(closes).toBe(1)
  })

  it('rejects concurrent destroy() calls with the same error, each hook having run once', async () => {
    const events: string[] = []
    const failure = new Error('disconnect failed')

    @Injectable()
    class Failing {
      onShutdown() {
        events.push('Failing.onShutdown')
      }
      onDestroy() {
        events.push('Failing.onDestroy')
        throw failure
      }
    }

    const app = new Miia({ logger: false }).provide(Failing)
    await app.init()
    const results = await Promise.allSettled([app.destroy(), app.destroy()])
    expect(results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ])
    expect(events).toEqual(['Failing.onShutdown', 'Failing.onDestroy'])
  })

  it('logs each failure with its source', async () => {
    const errors: Array<{ message: string; trace?: string }> = []
    const logger: LoggerService = {
      log() {},
      warn() {},
      error(message, trace) {
        errors.push({ message, trace })
      },
    }

    @Injectable()
    class Failing {
      onDestroy() {
        throw new Error('disconnect failed')
      }
    }

    const app = new Miia({ logger }).provide(Failing)
    await app.init()
    await destroyError(app)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toBe('Failing.onDestroy() failed during shutdown')
    expect(errors[0]!.trace).toContain('disconnect failed')
  })
})

describe('shutdown without a complete init()', () => {
  it('destroys what app.get() built, in reverse dependency order', async () => {
    const events: string[] = []

    function service(name: string) {
      return class extends tracked(events, name) {
        onInit() {
          events.push(`${name}.onInit`)
        }
      }
    }

    @Injectable()
    class UsersService extends service('Users') {}

    @Injectable()
    class OrdersService extends service('Orders') {
      users = inject(UsersService)
    }

    @Module({ global: true, providers: [UsersService], exports: [UsersService] })
    class UsersModule {}

    @Module({ providers: [OrdersService] })
    class OrdersModule {}

    @Module({ imports: [OrdersModule, UsersModule] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    app.get(OrdersService)
    await app.destroy()
    expect(events).toEqual(['Orders.onShutdown', 'Users.onShutdown', 'Orders.onDestroy', 'Users.onDestroy'])
  })

  it('destroys what was built after init() failed on a cycle through deps', async () => {
    const events: string[] = []
    const A = createToken<object>('A')

    @Injectable()
    class B extends tracked(events, 'B') {
      a = inject(A)
    }

    @Controller('/')
    class Ctrl extends tracked(events, 'Ctrl') {}

    @Module({ controllers: [Ctrl], providers: [provider(A, () => hooks(events, 'A'), { deps: [B] }), B] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect((await initError(app)).message).toStartWith(
      '[Miia] Circular dependency detected: A (AppModule) -> B (AppModule) -> A (AppModule)',
    )
    await app.destroy()
    expect(events.toSorted()).toEqual([
      'A.onDestroy',
      'A.onShutdown',
      'B.onDestroy',
      'B.onShutdown',
      'Ctrl.onDestroy',
      'Ctrl.onShutdown',
    ])
  })

  it('destroys what was built after init() failed on an unregistered deps entry', async () => {
    const events: string[] = []
    const MISSING = createToken<object>('Missing')
    const LAZY = createToken<object>('Lazy')

    @Injectable()
    class Service extends tracked(events, 'Service') {}

    @Controller('/')
    class Ctrl extends tracked(events, 'Ctrl') {
      service = inject(Service)
      lazy = inject(LAZY)
    }

    @Module({
      controllers: [Ctrl],
      providers: [Service, provider(LAZY, () => hooks(events, 'Lazy'), { deps: [MISSING] })],
    })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect((await initError(app)).message.split('\n')[0]).toBe(
      '[Miia] No provider found for token: Missing, required by deps of Lazy (AppModule)',
    )
    await app.destroy()
    expect(events).toEqual([
      'Ctrl.onShutdown',
      'Lazy.onShutdown',
      'Service.onShutdown',
      'Ctrl.onDestroy',
      'Lazy.onDestroy',
      'Service.onDestroy',
    ])
  })
})
