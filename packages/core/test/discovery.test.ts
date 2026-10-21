import { beforeEach, describe, expect, it } from 'bun:test'
import type { CanActivate } from '@miiajs/core'
import {
  Controller,
  createClassDecorator,
  createLazyProxy,
  createMethodDecorator,
  createToken,
  DiscoveryService,
  Get,
  getMeta,
  Injectable,
  Miia,
  Module,
  provider,
  RESOLVED_PREFIX,
  Router,
  inject,
  pushMeta,
  setMeta,
} from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { Container } from '../src/di-container.js'
import { createToken as createSrcToken } from '../src/di-token.js'
// The Container from src only recognises proxies made by the src module
import { createLazyProxy as createSrcLazyProxy } from '../src/utils/lazy-proxy.js'

// ─── Container-level tests ──────────────────────────────────────

describe('Container.singletonInstances', () => {
  let c: Container

  beforeEach(() => {
    c = new Container()
  })

  it('returns constructed singletons in registration order', async () => {
    class A {}
    class B {}
    c.registerClass(A)
    c.registerClass(B)
    await c.initAll()

    const list = c.singletonInstances()
    expect(list).toHaveLength(2)
    expect(list[0]).toBeInstanceOf(A)
    expect(list[1]).toBeInstanceOf(B)
  })

  it('includes an instance registered under a token object', async () => {
    class Options {}
    const options = new Options()
    c.register(createSrcToken<Options>('Options'), () => options)
    await c.initAll()

    const list = c.singletonInstances()
    expect(list).toHaveLength(1)
    expect(list[0]).toBe(options)
  })

  it('lists an instance registered under two tokens once', async () => {
    class Shared {}
    c.registerClass(Shared)
    c.register(createSrcToken<Shared>('SharedAlias'), (r) => r(Shared))
    await c.initAll()

    const list = c.singletonInstances()
    expect(list).toHaveLength(1)
    expect(list[0]).toBe(c.resolve(Shared))
  })

  it('skips null, primitives and functions', async () => {
    class A {}
    c.registerClass(A)
    c.register(createSrcToken('Nothing'), () => null)
    c.register(createSrcToken('Name'), () => 'miia')
    c.register(createSrcToken('Port'), () => 3000)
    c.register(createSrcToken('Callback'), () => function callback() {})
    await c.initAll()

    const list = c.singletonInstances()
    expect(list).toHaveLength(1)
    expect(list[0]).toBeInstanceOf(A)
  })

  it('skips transient and request providers', async () => {
    class Singleton {}
    class Transient {}
    class Request {}
    c.registerClass(Singleton, 'singleton')
    c.registerClass(Transient, 'transient')
    c.registerClass(Request, 'request')
    await c.initAll()

    const list = c.singletonInstances()
    expect(list).toHaveLength(1)
    expect(list[0]).toBeInstanceOf(Singleton)
  })

  it('skips singletons that have not been constructed yet', () => {
    class A {}
    c.registerClass(A)
    // no initAll() / resolve() - instance is undefined
    expect(c.singletonInstances()).toHaveLength(0)
  })

  it('skips a lazy proxy, before and after its first use', async () => {
    class Target {
      value = 1
    }
    const LAZY = createSrcToken<Target>('LazyTarget')
    c.registerClass(Target)
    c.register(LAZY, (r) => createSrcLazyProxy(() => r(Target)))
    await c.initAll()

    expect(c.singletonInstances()).toHaveLength(1)
    expect(c.resolve(LAZY).value).toBe(1)
    const list = c.singletonInstances()
    expect(list).toHaveLength(1)
    expect(list[0]).toBe(c.resolve(Target))
  })
})

describe('Container.bootstrapAll', () => {
  let c: Container

  beforeEach(() => {
    c = new Container()
  })

  it('calls onReady on all singletons that define it', async () => {
    const calls: string[] = []
    c.register(createSrcToken('a'), () => ({
      onReady: async () => {
        calls.push('a-ready')
      },
    }))
    c.register(createSrcToken('b'), () => ({
      onReady: async () => {
        calls.push('b-ready')
      },
    }))

    await c.initAll()
    await c.bootstrapAll()
    expect(calls).toContain('a-ready')
    expect(calls).toContain('b-ready')
  })

  it('runs onReady strictly after all onInit hooks', async () => {
    const order: string[] = []
    c.register(createSrcToken('a'), () => ({
      onInit: async () => {
        order.push('a-init')
      },
      onReady: async () => {
        order.push('a-ready')
      },
    }))
    c.register(createSrcToken('b'), () => ({
      onInit: async () => {
        order.push('b-init')
      },
      onReady: async () => {
        order.push('b-ready')
      },
    }))

    await c.initAll()
    await c.bootstrapAll()

    // All inits must come before any ready
    const lastInit = Math.max(order.indexOf('a-init'), order.indexOf('b-init'))
    const firstReady = Math.min(order.indexOf('a-ready'), order.indexOf('b-ready'))
    expect(lastInit).toBeLessThan(firstReady)
  })

  it('skips providers without onReady', async () => {
    c.register(createSrcToken('noop'), () => ({}))
    await c.initAll()
    await expect(c.bootstrapAll()).resolves.toBeUndefined()
  })

  it('skips transient providers', async () => {
    const calls: string[] = []
    c.register(
      createSrcToken('t'),
      () => ({
        onReady: async () => {
          calls.push('transient-ready')
        },
      }),
      'transient',
    )
    await c.initAll()
    await c.bootstrapAll()
    expect(calls).toEqual([])
  })
})

// ─── DiscoveryService E2E via TestApp ───────────────────────────

const ON = Symbol('miia:test:on')

interface OnMeta {
  event: string
  handlerName: string
}

const On = createMethodDecorator<[event: string]>((_target, ctx, event) => {
  pushMeta(ctx.metadata!, ON, { event, handlerName: ctx.name as string } satisfies OnMeta)
})

const TAG = Symbol('miia:test:tag')

const Tag = createClassDecorator<[name: string]>((_target, ctx, name) => {
  setMeta(ctx.metadata!, TAG, name)
})

type Handler = (payload: unknown) => void | Promise<void>

@Injectable()
class EventBus {
  private discovery = inject(DiscoveryService)
  private handlers = new Map<string, Handler[]>()
  readyCalled = false

  async onReady() {
    this.readyCalled = true
    for (const { instance, methodName, metadata } of this.discovery.getMethodsWithMeta<OnMeta>(ON)) {
      const list = this.handlers.get(metadata.event) ?? []
      list.push(((instance as any)[methodName] as Handler).bind(instance))
      this.handlers.set(metadata.event, list)
    }
  }

  async emit(event: string, payload: unknown): Promise<void> {
    const list = this.handlers.get(event) ?? []
    for (const fn of list) await fn(payload)
  }

  getHandlerCount(event: string): number {
    return this.handlers.get(event)?.length ?? 0
  }
}

@Injectable()
class UserEventsService {
  received: Array<{ event: string; payload: unknown }> = []

  @On('user.created')
  onUserCreated(payload: unknown) {
    this.received.push({ event: 'user.created', payload })
  }

  @On('user.deleted')
  onUserDeleted(payload: unknown) {
    this.received.push({ event: 'user.deleted', payload })
  }
}

@Injectable()
class AuditService {
  logs: string[] = []

  @On('user.created')
  audit(payload: unknown) {
    this.logs.push(`audit:${JSON.stringify(payload)}`)
  }
}

@Controller('/ping')
class PingController {
  @Get('/')
  ping() {
    return 'pong'
  }

  @On('ping.fired')
  onPing() {
    // controllers can also host @On handlers
  }
}

@Module({
  controllers: [PingController],
  providers: [EventBus, UserEventsService, AuditService],
})
class TestAppModule {}

describe('DiscoveryService', () => {
  it('is auto-registered - no explicit provide() needed', async () => {
    const app = await TestApp.create(TestAppModule).compile()

    const discovery = app.resolve(DiscoveryService)
    expect(discovery).toBeInstanceOf(DiscoveryService)

    await app.close()
  })

  it('getClassesWithMeta finds providers and controllers whose class carries the key', async () => {
    @Tag('service')
    @Injectable()
    class TaggedService {}

    @Tag('controller')
    @Controller('/tagged')
    class TaggedController {
      @Get('/')
      get() {
        return 'ok'
      }
    }

    @Injectable()
    class Untagged {}

    @Module({ controllers: [TaggedController], providers: [TaggedService, Untagged] })
    class M {}

    const app = await TestApp.create(M).compile()

    const found = app.resolve(DiscoveryService).getClassesWithMeta<string>(TAG)
    expect(found).toHaveLength(2)
    const service = found.find((f) => f.ctor === TaggedService)
    const controller = found.find((f) => f.ctor === TaggedController)
    expect(service?.instance).toBe(app.resolve(TaggedService))
    expect(service?.metadata).toBe('service')
    expect(controller?.instance).toBe(app.resolve(TaggedController))
    expect(controller?.metadata).toBe('controller')

    await app.close()
  })

  it('getMethodsWithMeta discovers @On across providers and controllers', async () => {
    const app = await TestApp.create(TestAppModule).compile()

    const discovery = app.resolve(DiscoveryService)
    const found = discovery.getMethodsWithMeta<OnMeta>(ON)

    const events = found.map((f) => f.metadata.event).sort()
    expect(events).toEqual(['ping.fired', 'user.created', 'user.created', 'user.deleted'])

    // Ensure methodName is extracted from handlerName and instance is bound
    const userCreated = found.filter((f) => f.metadata.event === 'user.created')
    expect(userCreated).toHaveLength(2)
    expect(userCreated.map((f) => f.methodName).sort()).toEqual(['audit', 'onUserCreated'])

    await app.close()
  })

  it('getMethodsWithMeta returns empty array for unused key', async () => {
    const app = await TestApp.create(TestAppModule).compile()

    const discovery = app.resolve(DiscoveryService)
    const found = discovery.getMethodsWithMeta(Symbol('unused'))
    expect(found).toEqual([])

    await app.close()
  })

  it('can be overridden via TestApp.override', async () => {
    const fakeDiscovery = {
      getClassesWithMeta: () => [],
      getMethodsWithMeta: () => [],
    }

    const app = await TestApp.create(TestAppModule).override(DiscoveryService, fakeDiscovery).compile()

    const resolved = app.resolve(DiscoveryService)
    expect(resolved).toBe(fakeDiscovery as unknown as DiscoveryService)
    expect(resolved.getClassesWithMeta(TAG)).toEqual([])

    await app.close()
  })

  it('finds a handler class behind a factory provider under a token object', async () => {
    class FactoryHandlers {
      received: unknown[] = []

      @On('factory.fired')
      onFired(payload: unknown) {
        this.received.push(payload)
      }
    }
    const HANDLERS = createToken<FactoryHandlers>('FactoryHandlers')

    @Module({ providers: [EventBus, provider(HANDLERS, () => new FactoryHandlers())] })
    class M {}

    const app = await TestApp.create(M).compile()

    const found = app.resolve(DiscoveryService).getMethodsWithMeta<OnMeta>(ON)
    expect(found).toHaveLength(1)
    expect(found[0]?.ctor).toBe(FactoryHandlers)
    expect(found[0]?.instance).toBe(app.resolve(HANDLERS))

    await app.resolve(EventBus).emit('factory.fired', { id: 1 })
    expect(app.resolve(HANDLERS).received).toEqual([{ id: 1 }])

    await app.close()
  })

  it('returns one entry for an instance registered under two tokens', async () => {
    @Tag('shared')
    @Injectable()
    class SharedHandlers {
      @On('shared.fired')
      onFired() {}
    }
    const ALIAS = createToken<SharedHandlers>('SharedAlias')

    @Module({ providers: [SharedHandlers, provider(ALIAS, (r) => r(SharedHandlers))] })
    class M {}

    const app = await TestApp.create(M).compile()
    const discovery = app.resolve(DiscoveryService)

    expect(app.resolve(ALIAS)).toBe(app.resolve(SharedHandlers))
    expect(discovery.getMethodsWithMeta<OnMeta>(ON)).toHaveLength(1)
    expect(discovery.getClassesWithMeta(TAG)).toHaveLength(1)

    await app.close()
  })

  it('does not find a plain-object override, finds a named subclass override', async () => {
    @Tag('mail')
    @Injectable()
    class MailHandler {
      @On('mail.sent')
      onSent() {}
    }

    class FakeMailHandler extends MailHandler {}

    @Module({ providers: [MailHandler] })
    class M {}

    const mocked = await TestApp.create(M)
      .override(MailHandler, { onSent() {} })
      .compile()
    expect(mocked.resolve(DiscoveryService).getMethodsWithMeta(ON)).toEqual([])
    expect(mocked.resolve(DiscoveryService).getClassesWithMeta(TAG)).toEqual([])
    await mocked.close()

    const subclassed = await TestApp.create(M).override(MailHandler, new FakeMailHandler()).compile()
    const methods = subclassed.resolve(DiscoveryService).getMethodsWithMeta<OnMeta>(ON)
    expect(methods).toHaveLength(1)
    expect(methods[0]?.ctor).toBe(FakeMailHandler)
    expect(methods[0]?.instance).toBe(subclassed.resolve(MailHandler))
    expect(methods[0]?.methodName).toBe('onSent')
    const classes = subclassed.resolve(DiscoveryService).getClassesWithMeta<string>(TAG)
    expect(classes).toHaveLength(1)
    expect(classes[0]?.ctor).toBe(FakeMailHandler)
    expect(classes[0]?.metadata).toBe('mail')
    await subclassed.close()
  })

  it('skips a lazy proxy and does not resolve it - only its registered target is found', async () => {
    @Injectable()
    class LazyTarget {
      value = 1

      @On('lazy.fired')
      onFired() {}
    }
    const LAZY = createToken<LazyTarget>('LazyTarget')
    let resolved = 0

    @Module({
      providers: [
        LazyTarget,
        provider(LAZY, (r) =>
          createLazyProxy(() => {
            resolved++
            return r(LazyTarget)
          }),
        ),
      ],
    })
    class M {}

    const app = await TestApp.create(M).compile()
    const discovery = app.resolve(DiscoveryService)

    expect(discovery.getMethodsWithMeta(ON)).toHaveLength(1)
    expect(resolved).toBe(0)

    expect(app.resolve(LAZY).value).toBe(1)
    expect(resolved).toBe(1)
    const found = discovery.getMethodsWithMeta(ON)
    expect(found).toHaveLength(1)
    expect(found[0]?.instance).toBe(app.resolve(LazyTarget))

    await app.close()
  })

  it('skips providers whose value is null, a string or a number', async () => {
    @Module({
      providers: [
        UserEventsService,
        provider(createToken<null>('Nothing'), () => null),
        provider(createToken<string>('Name'), () => 'miia'),
        provider(createToken<number>('Port'), () => 3000),
      ],
    })
    class M {}

    const app = await TestApp.create(M).compile()
    const discovery = app.resolve(DiscoveryService)

    const methods = discovery.getMethodsWithMeta<OnMeta>(ON).map((f) => f.methodName)
    expect(methods.sort()).toEqual(['onUserCreated', 'onUserDeleted'])
    expect(discovery.getClassesWithMeta(TAG)).toEqual([])

    await app.close()
  })

  it('throws when called before every provider is constructed', async () => {
    @Injectable()
    class EagerScanner {
      found = inject(DiscoveryService).getMethodsWithMeta(ON)
    }

    @Module({ providers: [EagerScanner] })
    class M {}

    await expect(TestApp.create(M).compile()).rejects.toThrow(
      '[Miia] DiscoveryService.getMethodsWithMeta() was called before every provider was constructed - ' +
        'call it from onReady() (or onInit())',
    )

    const app = new Miia({ logger: false }).register(TestAppModule)
    expect(() => app.get(DiscoveryService).getClassesWithMeta(TAG)).toThrow(
      'DiscoveryService.getClassesWithMeta() was called before every provider was constructed',
    )
    await app.destroy()
  })

  it('works from onInit()', async () => {
    @Injectable()
    class InitScanner {
      private discovery = inject(DiscoveryService)
      methods: string[] = []

      async onInit() {
        this.methods = this.discovery.getMethodsWithMeta<OnMeta>(ON).map((f) => f.methodName)
      }
    }

    @Module({ providers: [InitScanner, UserEventsService] })
    class M {}

    const app = await TestApp.create(M).compile()

    expect(app.resolve(InitScanner).methods.sort()).toEqual(['onUserCreated', 'onUserDeleted'])

    await app.close()
  })

  it('finds a global guard registered only through useGuard() from onInit()', async () => {
    @Tag('guard')
    class TaggedGuard implements CanActivate {
      canActivate() {
        return true
      }
    }

    @Injectable()
    class GuardScanner {
      private discovery = inject(DiscoveryService)
      found: unknown[] = []

      async onInit() {
        this.found = this.discovery.getClassesWithMeta(TAG).map((f) => f.ctor)
      }
    }

    @Module({ providers: [GuardScanner] })
    class M {}

    const app = await TestApp.create(M).useGuard(TaggedGuard).compile()

    expect(app.resolve(GuardScanner).found).toEqual([TaggedGuard])

    await app.close()
  })
})

describe('onReady lifecycle hook', () => {
  it('is invoked for providers in a Miia app', async () => {
    const app = await TestApp.create(TestAppModule).compile()

    const bus = app.resolve(EventBus)
    expect(bus.readyCalled).toBe(true)

    await app.close()
  })

  it('EventBus wires up @On handlers via DiscoveryService in onReady', async () => {
    const app = await TestApp.create(TestAppModule).compile()

    const bus = app.resolve(EventBus)
    expect(bus.getHandlerCount('user.created')).toBe(2)
    expect(bus.getHandlerCount('user.deleted')).toBe(1)
    expect(bus.getHandlerCount('ping.fired')).toBe(1)

    await app.close()
  })

  it('emitted events reach @On-decorated methods on providers with correct this binding', async () => {
    const app = await TestApp.create(TestAppModule).compile()

    const bus = app.resolve(EventBus)
    const users = app.resolve(UserEventsService)
    const audit = app.resolve(AuditService)

    await bus.emit('user.created', { id: 1, name: 'Ada' })
    await bus.emit('user.deleted', { id: 2 })

    expect(users.received).toEqual([
      { event: 'user.created', payload: { id: 1, name: 'Ada' } },
      { event: 'user.deleted', payload: { id: 2 } },
    ])
    expect(audit.logs).toEqual(['audit:{"id":1,"name":"Ada"}'])

    await app.close()
  })
})

// ─── RESOLVED_PREFIX metadata ────────────────────────────────────

@Controller('/users')
class UsersCtrl {
  @Get('/')
  list() {
    return []
  }
}

@Controller('/posts')
class PostsCtrl {
  @Get('/')
  list() {
    return []
  }
}

@Module({ prefix: '/api/v1', controllers: [UsersCtrl, PostsCtrl] })
class ApiModule {}

@Controller('/ping')
class RootCtrl {
  @Get('/')
  ping() {
    return 'pong'
  }
}

@Module({ imports: [ApiModule], controllers: [RootCtrl] })
class RootModule {}

describe('RESOLVED_PREFIX metadata', () => {
  it('attaches the fully-resolved prefix (module prefix + controller prefix) to each controller class', async () => {
    const app = await TestApp.create(RootModule).compile()

    expect(getMeta<string>(UsersCtrl, RESOLVED_PREFIX)).toBe('api/v1/users')
    expect(getMeta<string>(PostsCtrl, RESOLVED_PREFIX)).toBe('api/v1/posts')
    expect(getMeta<string>(RootCtrl, RESOLVED_PREFIX)).toBe('ping')

    await app.close()
  })

  it('allows DiscoveryService consumers to pair controllers with their routing prefix', async () => {
    const app = await TestApp.create(RootModule).compile()
    const discovery = app.resolve(DiscoveryService)

    const controllers = discovery.getClassesWithMeta<string>(RESOLVED_PREFIX)

    const prefixes = controllers.map((c) => c.metadata).sort()
    expect(prefixes).toEqual(['api/v1/posts', 'api/v1/users', 'ping'])
    expect(controllers.find((c) => c.ctor === UsersCtrl)?.instance).toBe(app.resolve(UsersCtrl))

    await app.close()
  })
})

// ─── Router injectable ───────────────────────────────────────────

describe('Router DI registration', () => {
  it('is injectable and resolves to the same instance used for routing', async () => {
    const app = new Miia({ logger: false })
    const router1 = app.get(Router)
    const router2 = app.get(Router)

    expect(router1).toBeInstanceOf(Router)
    expect(router1).toBe(router2)

    await app.destroy()
  })

  it('can be injected into a provider and lets it register routes at onReady', async () => {
    @Injectable()
    class RouteRegistrar {
      private router = inject(Router)

      async onReady() {
        this.router.add('GET', '/injected', () => new Response('hi from injected'))
      }
    }

    @Module({ providers: [RouteRegistrar] })
    class M {}

    const app = await TestApp.create(M).compile()
    const res = await app.request('GET', '/injected')

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hi from injected')

    await app.close()
  })
})
