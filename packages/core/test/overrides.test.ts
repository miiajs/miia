import { describe, expect, it } from 'bun:test'
import type { CanActivate, ConfiguredModule, RequestContext } from '../src/index.js'
import {
  Controller,
  createToken,
  DiscoveryService,
  Get,
  inject,
  Injectable,
  isOverride,
  Miia,
  Module,
  overrideModule,
  overrideProvider,
  provider,
  REQUEST_CONTEXT,
  UseGuard,
} from '../src/index.js'

function get(app: Miia, path: string): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`http://localhost${path}`)))
}

function thrownBy(fn: () => unknown): Error {
  try {
    fn()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected a throw')
}

const CONFIG = createToken<string>('CONFIG')

function makeConfigLike() {
  class ConfigLikeModule {
    static configure(value: string): ConfiguredModule {
      return { module: ConfigLikeModule, providers: [{ token: CONFIG, factory: () => value }], exports: [CONFIG] }
    }
  }
  return ConfigLikeModule
}

describe('override descriptors', () => {
  it('are recognised by isOverride()', () => {
    expect(isOverride(overrideProvider(createToken('X'), () => 1))).toBe(true)
    expect(isOverride(overrideModule(makeConfigLike().configure('x')))).toBe(true)
    expect(isOverride(makeConfigLike().configure('x'))).toBe(false)
    expect(isOverride(null)).toBe(false)
  })

  it('replace a provider of a module, also inside the controller that injects it', async () => {
    @Injectable()
    class GreetingService {
      greet() {
        return 'real'
      }
    }

    @Controller('/greet')
    class GreetController {
      private greeting = inject(GreetingService)

      @Get('/')
      greet(_ctx: RequestContext) {
        return { text: this.greeting.greet() }
      }
    }

    @Module({ controllers: [GreetController], providers: [GreetingService] })
    class GreetModule {}

    const app = new Miia({ logger: false }).register(
      GreetModule,
      overrideProvider(GreetingService, () => ({ greet: () => 'fake' })),
    )

    const res = await get(app, '/greet')
    expect(await res.json()).toEqual({ text: 'fake' })
  })

  it('replace the built-in DiscoveryService before controllers are built', () => {
    const fake = { getClassesWithMeta: () => [], getMethodsWithMeta: () => [] }

    @Controller('/c')
    class UsesDiscovery {
      discovery = inject(DiscoveryService)
    }

    @Module({ controllers: [UsesDiscovery] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(
      AppModule,
      overrideProvider(DiscoveryService, () => fake),
    )

    expect(app.get(DiscoveryService)).toBe(fake as unknown as DiscoveryService)
    expect(app.get(UsesDiscovery).discovery).toBe(fake as unknown as DiscoveryService)
  })

  it('replace a provide() token', () => {
    @Module({})
    class EmptyModule {}

    const CLOCK = createToken<string>('CLOCK')
    const app = new Miia({ logger: false }).provide({ token: CLOCK, factory: () => 'real' }).register(
      EmptyModule,
      overrideProvider(CLOCK, () => 'fake'),
    )

    expect(app.get(CLOCK)).toBe('fake')
  })

  it('replace a factory provider of a configured module', () => {
    const DB = createToken<{ query: () => string }>('DB')

    class DbModule {
      static configure(): ConfiguredModule {
        return { module: DbModule, providers: [{ token: DB, factory: () => ({ query: () => 'real' }) }] }
      }
    }

    const app = new Miia({ logger: false }).register(
      DbModule.configure(),
      overrideProvider(DB, () => ({ query: () => 'fake' })),
    )

    expect(app.get(DB).query()).toBe('fake')
  })

  it('replace a guard and a controller declared by the loaded module', async () => {
    class Deny implements CanActivate {
      canActivate() {
        return false
      }
    }

    @Controller('/guarded')
    @UseGuard(Deny)
    class GuardedController {
      @Get('/')
      read(_ctx: RequestContext) {
        return { from: 'real' }
      }
    }

    @Module({ controllers: [GuardedController], providers: [Deny] })
    class GuardedModule {}

    const app = new Miia({ logger: false }).register(
      GuardedModule,
      overrideProvider(Deny, () => ({ canActivate: () => true })),
      overrideProvider(GuardedController, () => ({ read: () => ({ from: 'fake' }) })),
    )

    const res = await get(app, '/guarded')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ from: 'fake' })
  })

  it('keep the duplicate check for an overridden token', () => {
    @Injectable()
    class SharedService {}

    @Module({ providers: [SharedService] })
    class ModuleA {}

    @Module({ providers: [SharedService] })
    class ModuleB {}

    const app = new Miia({ logger: false }).register(
      ModuleA,
      ModuleB,
      overrideProvider(SharedService, () => ({})),
    )

    expect(() => app.get(SharedService)).toThrow('[Miia] SharedService is provided by both ModuleA and ModuleB')
  })

  it('reject a provider override no loaded module uses', () => {
    @Module({})
    class EmptyModule {}

    const app = new Miia({ logger: false }).register(
      EmptyModule,
      overrideProvider(createToken('MISSING'), () => 1),
    )

    const err = thrownBy(() => app.get(EmptyModule))
    expect(err.message).toBe(
      '[Miia] override(MISSING): no loaded module provides MISSING - use provide() for a module-less test',
    )
    expect(err.constructor).toBe(Error)
  })

  it('reject REQUEST_CONTEXT before anything is registered', async () => {
    @Module({})
    class EmptyModule {}

    const app = new Miia({ logger: false }).register(
      EmptyModule,
      overrideProvider(REQUEST_CONTEXT, () => ({})),
    )

    await expect(app.init()).rejects.toThrow(
      '[Miia] override(RequestContext): REQUEST_CONTEXT is built in and seeded by every request - it cannot be provided or overridden; test a request-scoped provider through a route with TestApp.request(), or override that provider itself',
    )
  })

  it('reject a descriptor inside imports', () => {
    @Module({ imports: [overrideProvider(createToken('X'), () => 1) as unknown as ConfiguredModule] })
    class BadModule {}

    const app = new Miia({ logger: false }).register(BadModule)

    expect(() => app.get(BadModule)).toThrow(
      '[Miia] override descriptors are only allowed at the top level of register()',
    )
  })
})

describe('module override descriptors', () => {
  it('replace a configured module by its pair, wherever the graph imports it', async () => {
    const ConfigLikeModule = makeConfigLike()

    @Injectable()
    class FeatureService {
      config = inject(CONFIG)
    }

    @Controller('/feature')
    class FeatureController {
      private service = inject(FeatureService)

      @Get('/')
      read(_ctx: RequestContext) {
        return { config: this.service.config }
      }
    }

    @Module({ imports: [ConfigLikeModule], controllers: [FeatureController], providers: [FeatureService] })
    class FeatureModule {}

    @Module({ imports: [ConfigLikeModule.configure('production'), FeatureModule] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule, overrideModule(ConfigLikeModule.configure('test')))

    const res = await get(app, '/feature')
    expect(await res.json()).toEqual({ config: 'test' })
  })

  it('reject a module the loaded graph does not configure', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({ imports: [ConfigLikeModule] })
    class FeatureModule {}

    const app = new Miia({ logger: false }).register(FeatureModule, overrideModule(ConfigLikeModule.configure('test')))

    const err = thrownBy(() => app.get(FeatureModule))
    expect(err.message).toBe(
      '[Miia] override(ConfigLikeModule): ConfigLikeModule is not configured in the loaded graph - ' +
        'if a module imports ConfigLikeModule bare and expects the root to configure it, register it alongside: ' +
        'TestApp.create(FeatureModule, ConfigLikeModule.configure(...))',
    )
    expect(err.constructor).toBe(Error)
  })

  it('are not needed when the configuration is registered next to a feature that imports it bare', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({ imports: [ConfigLikeModule] })
    class FeatureModule {}

    const app = new Miia({ logger: false }).register(FeatureModule, ConfigLikeModule.configure('test'))

    expect(app.get(CONFIG)).toBe('test')
  })
})

describe('provide()', () => {
  it('rejects REQUEST_CONTEXT and registers none of the providers passed with it', () => {
    const CLOCK = createToken<string>('CLOCK')
    const app = new Miia({ logger: false })

    const err = thrownBy(() =>
      app.provide(
        provider(CLOCK, () => 'real'),
        provider(REQUEST_CONTEXT, () => ({}) as RequestContext),
      ),
    )
    expect(err.message).toBe(
      '[Miia] provide(RequestContext): REQUEST_CONTEXT is built in and seeded by every request - it cannot be provided or overridden; test a request-scoped provider through a route with TestApp.request(), or override that provider itself',
    )
    expect(() => app.get(CLOCK)).toThrow('[Miia] No provider found for token: CLOCK')
  })
})
