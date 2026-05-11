import { beforeEach, describe, expect, it } from 'bun:test'
import {
  Container,
  Controller,
  createMethodDecorator,
  DiscoveryService,
  Get,
  getMeta,
  Injectable,
  Miia,
  Module,
  RESOLVED_PREFIX,
  Router,
  inject,
  pushMeta,
} from '../src/index.js'
import { TestApp } from '../src/testing/index.js'

// ─── Container-level tests ──────────────────────────────────────

describe('Container.getSingletonInstances', () => {
  let c: Container

  beforeEach(() => {
    c = new Container()
  })

  it('returns instantiated singletons keyed by class constructor', async () => {
    class A {}
    class B {}
    c.registerClass(A)
    c.registerClass(B)
    await c.initAll()

    const list = c.getSingletonInstances()
    expect(list).toHaveLength(2)
    expect(list.map((e) => e.ctor)).toContain(A)
    expect(list.map((e) => e.ctor)).toContain(B)
    expect(list[0]?.instance).toBeInstanceOf(list[0]!.ctor)
  })

  it('filters out string-token registrations', async () => {
    class A {}
    c.registerClass(A)
    c.register('STRING_TOKEN', () => ({ value: 1 }))
    await c.initAll()

    const list = c.getSingletonInstances()
    expect(list).toHaveLength(1)
    expect(list[0]?.ctor).toBe(A)
  })

  it('filters out transient and request providers', async () => {
    class Singleton {}
    class Transient {}
    class Request {}
    c.registerClass(Singleton, 'singleton')
    c.registerClass(Transient, 'transient')
    c.registerClass(Request, 'request')
    await c.initAll()

    const list = c.getSingletonInstances()
    expect(list).toHaveLength(1)
    expect(list[0]?.ctor).toBe(Singleton)
  })

  it('filters out singletons that have not been instantiated yet', () => {
    class A {}
    c.registerClass(A)
    // no initAll() / resolve() - instance is undefined
    expect(c.getSingletonInstances()).toHaveLength(0)
  })
})

describe('Container.bootstrapAll', () => {
  let c: Container

  beforeEach(() => {
    c = new Container()
  })

  it('calls onReady on all singletons that define it', async () => {
    const calls: string[] = []
    c.register('a', () => ({
      onReady: async () => {
        calls.push('a-ready')
      },
    }))
    c.register('b', () => ({
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
    c.register('a', () => ({
      onInit: async () => {
        order.push('a-init')
      },
      onReady: async () => {
        order.push('a-ready')
      },
    }))
    c.register('b', () => ({
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
    c.register('noop', () => ({}))
    await c.initAll()
    await expect(c.bootstrapAll()).resolves.toBeUndefined()
  })

  it('skips transient providers', async () => {
    const calls: string[] = []
    c.register(
      't',
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

  it('getSingletons returns providers AND controllers', async () => {
    const app = await TestApp.create(TestAppModule).compile()

    const discovery = app.resolve(DiscoveryService)
    const singletons = discovery.getSingletons()
    const ctors = singletons.map((s) => s.ctor)

    expect(ctors).toContain(EventBus)
    expect(ctors).toContain(UserEventsService)
    expect(ctors).toContain(AuditService)
    expect(ctors).toContain(PingController)

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
      getSingletons: () => [],
      getMethodsWithMeta: () => [],
    }

    const app = await TestApp.create(TestAppModule).override(DiscoveryService, fakeDiscovery).compile()

    const resolved = app.resolve(DiscoveryService)
    expect(resolved).toBe(fakeDiscovery as unknown as DiscoveryService)
    expect(resolved.getSingletons()).toEqual([])

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

    const controllers: Array<{ ctor: unknown; prefix: string }> = []
    for (const { ctor } of discovery.getSingletons()) {
      const prefix = getMeta<string>(ctor, RESOLVED_PREFIX)
      if (prefix !== undefined) controllers.push({ ctor, prefix })
    }

    const prefixes = controllers.map((c) => c.prefix).sort()
    expect(prefixes).toEqual(['api/v1/posts', 'api/v1/users', 'ping'])

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
