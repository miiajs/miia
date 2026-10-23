import { describe, expect, it } from 'bun:test'
import type { AnyToken, ConfiguredModule, RequestContext } from '../src/index.js'
import {
  Controller,
  createToken,
  forwardRef,
  Get,
  Injectable,
  Miia,
  Module,
  overrideModule,
  overrideProvider,
  Router,
} from '../src/index.js'
import type { ModuleGraph, ModuleNode } from '../src/app/module-graph.js'
import { CycleAModule, CycleAService } from './fixtures/cycle-a.module.js'
import { CycleBModule, CycleBService } from './fixtures/cycle-b.module.js'

type Item = Parameters<Miia['register']>[number]

function thrownBy(fn: () => unknown): Error {
  try {
    fn()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected a throw')
}

/** Processes the graph without running lifecycle hooks. */
function loaded(app: Miia): ModuleGraph {
  app.get(Router)
  return (app as unknown as { container: { graph: ModuleGraph } }).container.graph
}

function graphOf(...items: Item[]): ModuleGraph {
  return loaded(new Miia({ logger: false }).register(...items))
}

function loadError(...items: Item[]): string {
  return thrownBy(() => graphOf(...items)).message
}

function nodeOf(graph: ModuleGraph, label: string): ModuleNode {
  const seen = new Set<ModuleNode>([graph.root])
  const queue = [graph.root]
  for (let node = queue.shift(); node; node = queue.shift()) {
    if (node.label === label) return node
    for (const next of node.imports) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  throw new Error(`no module node ${label}`)
}

function ownerOf(app: Miia, token: AnyToken): ModuleNode | null {
  const { registry } = (app as unknown as { container: { registry: Map<AnyToken, { owners: ModuleNode[] | null }> } })
    .container
  return registry.get(token)!.owners?.[0] ?? null
}

const CONFIG = createToken<string>('CONFIG')
const SECRET = createToken<string>('SECRET')

// A dynamic module the way packages write one: no @Module, a static configure().
function makeConfigLike() {
  class ConfigLikeModule {
    static configure(options: { exports?: boolean; global?: boolean; name?: string } = {}): ConfiguredModule {
      return {
        module: ConfigLikeModule,
        providers: [
          { token: CONFIG, factory: () => 'config' },
          { token: SECRET, factory: () => 'secret' },
        ],
        exports: options.exports ? [CONFIG] : undefined,
        global: options.global,
        name: options.name,
      }
    }
  }
  return ConfigLikeModule
}

describe('forwardRef', () => {
  it('loads two module files that import each other', () => {
    const graph = graphOf(CycleAModule)
    const a = nodeOf(graph, 'CycleAModule')
    const b = nodeOf(graph, 'CycleBModule')

    expect(a.imports).toEqual([b])
    expect(b.imports).toEqual([a])
    expect(graph.sees(a, CycleBService)).toBe(true)
    expect(graph.sees(b, CycleAService)).toBe(true)
  })

  it('calls the thunk once', () => {
    @Module({})
    class TargetModule {}

    let calls = 0
    @Module({
      imports: [
        forwardRef(() => {
          calls++
          return TargetModule
        }),
      ],
    })
    class UsersModule {}

    const graph = graphOf(UsersModule)

    expect(nodeOf(graph, 'UsersModule').imports).toEqual([nodeOf(graph, 'TargetModule')])
    expect(calls).toBe(1)
  })

  it('resolves to a configure() result, hosted by the module that imports it', () => {
    const ConfigLikeModule = makeConfigLike()
    const configured = ConfigLikeModule.configure()

    @Module({ imports: [forwardRef(() => configured)] })
    class AppModule {}

    const graph = graphOf(AppModule)

    expect(nodeOf(graph, 'ConfigLikeModule').host).toBe(nodeOf(graph, 'AppModule'))
  })

  it('rejects a thunk that returns undefined', () => {
    @Module({ imports: [forwardRef(() => undefined as never)] })
    class UsersModule {}

    expect(loadError(UsersModule)).toBe(
      '[Miia] forwardRef() in UsersModule `imports` returned undefined - expected a module class or a configure() result',
    )
  })

  it('rejects a thunk that returns something other than a module', () => {
    @Module({ exports: [forwardRef(() => ({}) as never)] })
    class UsersModule {}

    expect(loadError(UsersModule)).toBe(
      '[Miia] forwardRef() in UsersModule `exports` returned an object - expected a module class or a configure() result',
    )
  })

  it('rejects undefined in imports with the forwardRef advice', () => {
    @Module({})
    class OtherModule {}

    @Module({ imports: [OtherModule, undefined as never] })
    class UsersModule {}

    expect(loadError(UsersModule)).toBe(
      '[Miia] UsersModule imports undefined (index 1) - ' +
        'if two module files import each other, wrap both sides in forwardRef(() => X)',
    )
  })

  it('rejects undefined in exports and in register()', () => {
    @Module({ exports: [null as never] })
    class UsersModule {}

    expect(loadError(UsersModule)).toStartWith('[Miia] UsersModule exports null (index 0) - ')
    expect(loadError(UsersModule, undefined as never)).toStartWith('[Miia] register() imports undefined (index 1) - ')
  })
})

describe('ModuleGraph.sees()', () => {
  it('sees its own providers and the exports of its imports, not their other providers', () => {
    @Injectable()
    class MailService {}

    @Injectable()
    class MailTransport {}

    @Module({ providers: [MailService, MailTransport], exports: [MailService] })
    class MailModule {}

    @Injectable()
    class UsersService {}

    @Module({ imports: [MailModule], providers: [UsersService] })
    class UsersModule {}

    const graph = graphOf(UsersModule)
    const users = nodeOf(graph, 'UsersModule')

    expect(graph.sees(users, UsersService)).toBe(true)
    expect(graph.sees(users, MailService)).toBe(true)
    expect(graph.sees(users, MailTransport)).toBe(false)
    expect(graph.sees(nodeOf(graph, 'MailModule'), UsersService)).toBe(false)
  })

  it('follows a chain of re-exports', () => {
    @Injectable()
    class CService {}

    @Module({ providers: [CService], exports: [CService] })
    class CModule {}

    @Module({ imports: [CModule], exports: [CModule] })
    class BModule {}

    @Module({ imports: [BModule] })
    class AModule {}

    const graph = graphOf(AModule)

    expect(graph.sees(nodeOf(graph, 'AModule'), CService)).toBe(true)
    expect(graph.publicTokens(nodeOf(graph, 'BModule'))).toEqual(new Set([CService]))
  })

  it('does not loop on modules that re-export each other', () => {
    @Injectable()
    class AService {}

    @Injectable()
    class BService {}

    @Module({
      imports: [forwardRef(() => BModule)],
      providers: [AService],
      exports: [AService, forwardRef(() => BModule)],
    })
    class AModule {}

    @Module({ imports: [AModule], providers: [BService], exports: [BService, AModule] })
    class BModule {}

    @Module({ imports: [AModule] })
    class ConsumerModule {}

    const graph = graphOf(ConsumerModule)

    expect(graph.publicTokens(nodeOf(graph, 'AModule'))).toEqual(new Set([AService, BService]))
    expect(graph.sees(nodeOf(graph, 'ConsumerModule'), BService)).toBe(true)
  })

  it('sees the exports of a global module without importing it, and nothing else of it', () => {
    @Injectable()
    class ClockService {}

    @Injectable()
    class ClockSource {}

    @Module({ providers: [ClockService, ClockSource], exports: [ClockService], global: true })
    class ClockModule {}

    @Module({})
    class ReportsModule {}

    const graph = graphOf(ReportsModule, ClockModule)
    const reports = nodeOf(graph, 'ReportsModule')

    expect(nodeOf(graph, 'ClockModule').global).toBe(true)
    expect(graph.sees(reports, ClockService)).toBe(true)
    expect(graph.sees(reports, ClockSource)).toBe(false)
  })

  it('sees what a global module re-exports', () => {
    const ConfigLikeModule = makeConfigLike()
    const config = ConfigLikeModule.configure({ exports: true })

    @Module({ global: true, imports: [config], exports: [config] })
    class CoreModule {}

    @Module({})
    class ReportsModule {}

    const graph = graphOf(CoreModule, ReportsModule)
    const reports = nodeOf(graph, 'ReportsModule')

    expect(graph.sees(reports, CONFIG)).toBe(true)
    expect(graph.sees(reports, SECRET)).toBe(false)
  })

  it('sees nothing of a configured module without exports', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({ imports: [ConfigLikeModule.configure()] })
    class AppModule {}

    const graph = graphOf(AppModule)
    const configured = nodeOf(graph, 'ConfigLikeModule')

    expect(configured.hasExports).toBe(false)
    expect(configured.owns).toEqual(new Set([CONFIG, SECRET, ConfigLikeModule]))
    expect(graph.sees(nodeOf(graph, 'AppModule'), CONFIG)).toBe(false)
  })

  it('merges exports of @Module and of the configuration, and global from either', () => {
    const OWN = createToken<string>('OWN')

    @Module({ providers: [{ token: OWN, factory: () => 'own' }], exports: [OWN] })
    class MergedModule {
      static configure(global?: boolean): ConfiguredModule {
        return { module: MergedModule, providers: [{ token: CONFIG, factory: () => 'c' }], exports: [CONFIG], global }
      }
    }

    @Module({ global: true, exports: [] })
    class FlagModule {
      static configure(): ConfiguredModule {
        return { module: FlagModule }
      }
    }

    @Module({})
    class OtherModule {}

    const graph = graphOf(MergedModule.configure(true), FlagModule.configure(), OtherModule)
    const merged = nodeOf(graph, 'MergedModule')

    expect(graph.publicTokens(merged)).toEqual(new Set([OWN, CONFIG]))
    expect(merged.global).toBe(true)
    expect(merged.hasExports).toBe(true)
    expect(nodeOf(graph, 'FlagModule').global).toBe(true)
    expect(nodeOf(graph, 'FlagModule').hasExports).toBe(true)
    expect(graph.sees(nodeOf(graph, 'OtherModule'), CONFIG)).toBe(true)
  })

  it('lets the root see the exports of registered modules and of global ones', () => {
    @Injectable()
    class PublicService {}

    @Injectable()
    class PrivateService {}

    @Module({ providers: [PublicService, PrivateService], exports: [PublicService] })
    class FeatureModule {}

    @Injectable()
    class ClockService {}

    @Module({ providers: [ClockService], exports: [ClockService], global: true })
    class ClockModule {}

    @Module({ imports: [ClockModule] })
    class InfraModule {}

    const graph = graphOf(FeatureModule, InfraModule)

    expect(graph.root.owns.size).toBe(0)
    expect(graph.publicTokens(graph.root).size).toBe(0)
    expect(graph.sees(graph.root, PublicService)).toBe(true)
    expect(graph.sees(graph.root, PrivateService)).toBe(false)
    expect(graph.sees(graph.root, ClockService)).toBe(true)
  })

  it('counts a controller as owned by its module', () => {
    @Controller('/users')
    class UsersController {
      @Get('/')
      list(_ctx: RequestContext) {
        return []
      }
    }

    @Module({ controllers: [UsersController], exports: [UsersController] })
    class UsersModule {}

    const graph = graphOf(UsersModule)
    const users = nodeOf(graph, 'UsersModule')

    expect(users.owns.has(UsersController)).toBe(true)
    expect(users.exportedTokens.has(UsersController)).toBe(true)
  })
})

describe('exports (R5)', () => {
  it('rejects a token the module does not provide', () => {
    @Injectable()
    class MailService {}

    @Module({ providers: [MailService] })
    class MailModule {}

    @Module({ imports: [MailModule], exports: [MailService] })
    class UsersModule {}

    expect(loadError(UsersModule)).toBe(
      '[Miia] UsersModule exports MailService, which it neither provides nor imports - ' +
        'export its own providers or modules it imports',
    )
  })

  it('rejects a module that is not imported', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({})
    class MailModule {}

    @Module({ exports: [MailModule] })
    class UsersModule {}

    @Module({ exports: [ConfigLikeModule.configure({ name: 'logs' })] })
    class LogsModule {}

    expect(loadError(UsersModule)).toStartWith('[Miia] UsersModule exports MailModule, which it neither provides')
    expect(loadError(LogsModule)).toStartWith(
      "[Miia] LogsModule exports ConfigLikeModule (name 'logs'), which it neither provides",
    )
  })

  it('re-exports a configured import named by its bare class', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({ imports: [ConfigLikeModule.configure({ exports: true })], exports: [ConfigLikeModule] })
    class CoreModule {}

    const graph = graphOf(CoreModule)
    const core = nodeOf(graph, 'CoreModule')

    expect(core.reexports).toEqual([nodeOf(graph, 'ConfigLikeModule')])
    expect(graph.publicTokens(core)).toEqual(new Set([CONFIG]))
  })

  it('reduces forwardRef(() => X.configure()) in exports to the pair', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({
      imports: [ConfigLikeModule.configure({ exports: true, name: 'main' })],
      // A new object every call: it matches the import by (class, name), not by identity
      exports: [forwardRef(() => ConfigLikeModule.configure({ name: 'main' }))],
    })
    class CoreModule {}

    const graph = graphOf(CoreModule)

    expect(nodeOf(graph, 'CoreModule').reexports).toEqual([nodeOf(graph, "ConfigLikeModule (name 'main')")])
  })
})

describe('configured module host (R8)', () => {
  it('rejects one configure() result imported by register() and by a module', () => {
    const shared = makeConfigLike().configure()

    @Module({ imports: [shared] })
    class FeatureModule {}

    expect(loadError(shared, FeatureModule)).toBe(
      '[Miia] The same configured module ConfigLikeModule is imported by register() and FeatureModule - ' +
        'import it once and re-export it from that module, or make it global',
    )
  })

  it('accepts one result listed twice by the same host', () => {
    const shared = makeConfigLike().configure()

    @Module({ imports: [shared, shared] })
    class AppModule {}

    const graph = graphOf(AppModule)

    expect(nodeOf(graph, 'ConfigLikeModule').host).toBe(nodeOf(graph, 'AppModule'))
  })

  it('knows the host when a bare import reaches the module first', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({ imports: [ConfigLikeModule] })
    class FeatureModule {}

    @Module({ imports: [FeatureModule, ConfigLikeModule.configure()] })
    class AppModule {}

    const graph = graphOf(FeatureModule, AppModule)
    const configured = nodeOf(graph, 'ConfigLikeModule')

    expect(nodeOf(graph, 'FeatureModule').imports).toEqual([configured])
    expect(configured.host).toBe(nodeOf(graph, 'AppModule'))
    expect(configured.configured).toBe(true)
    expect(configured.where).toBe('ConfigLikeModule in AppModule')
  })

  it('is the root for a configuration passed to register()', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({})
    class PlainModule {}

    const graph = graphOf(ConfigLikeModule.configure({ name: 'main' }), PlainModule)
    const configured = nodeOf(graph, "ConfigLikeModule (name 'main')")

    expect(configured.host).toBe(graph.root)
    expect(configured.where).toBe("ConfigLikeModule (name 'main') in register()")
    expect(nodeOf(graph, 'PlainModule').host).toBeNull()
    expect(nodeOf(graph, 'PlainModule').where).toBe('PlainModule')
  })
})

describe('module override and global (R11a)', () => {
  it('rejects a replacement that sets another global', () => {
    const ConfigLikeModule = makeConfigLike()

    expect(loadError(ConfigLikeModule.configure(), overrideModule(ConfigLikeModule.configure({ global: true })))).toBe(
      '[Miia] override(ConfigLikeModule): the replacement sets global: true, but the configured module it replaces ' +
        'does not - leave global out, it is inherited',
    )
    expect(
      loadError(
        ConfigLikeModule.configure({ global: true }),
        overrideModule(ConfigLikeModule.configure({ global: false })),
      ),
    ).toBe(
      '[Miia] override(ConfigLikeModule): the replacement sets global: false, but the configured module it replaces ' +
        'is global - leave global out, it is inherited',
    )
  })

  it('inherits global from the configuration it replaces', () => {
    const ConfigLikeModule = makeConfigLike()

    const inherited = graphOf(
      ConfigLikeModule.configure({ global: true }),
      overrideModule(ConfigLikeModule.configure()),
    )
    const same = graphOf(
      ConfigLikeModule.configure({ global: true }),
      overrideModule(ConfigLikeModule.configure({ global: true })),
    )

    expect(nodeOf(inherited, 'ConfigLikeModule').global).toBe(true)
    expect(nodeOf(same, 'ConfigLikeModule').global).toBe(true)
  })

  it('compares with the global of @Module on the class too', () => {
    @Module({ global: true })
    class GlobalModule {
      static configure(global?: boolean): ConfiguredModule {
        return { module: GlobalModule, global }
      }
    }

    const graph = graphOf(GlobalModule.configure(), overrideModule(GlobalModule.configure(true)))

    expect(nodeOf(graph, 'GlobalModule').global).toBe(true)
    expect(loadError(GlobalModule.configure(), overrideModule(GlobalModule.configure(false)))).toStartWith(
      '[Miia] override(GlobalModule): the replacement sets global: false',
    )
  })
})

describe('duplicate providers (R11)', () => {
  it('names both modules', () => {
    @Injectable()
    class MailService {}

    @Module({ providers: [MailService] })
    class UsersModule {}

    @Module({ providers: [MailService] })
    class OrdersModule {}

    expect(loadError(UsersModule, OrdersModule)).toBe(
      '[Miia] MailService is provided by both UsersModule and OrdersModule - ' +
        "keep it in one module, add it to that module's exports, and import that module in the other",
    )
  })

  it('names two configured modules with their hosts', () => {
    const MODEL = createToken('PaprModel(users)')

    // A new anonymous module class per call, like papr / mongoose register()
    function registerModels(): ConfiguredModule {
      class PaprFeatureModule {}
      return { module: PaprFeatureModule, providers: [{ token: MODEL, factory: () => ({}) }] }
    }

    @Module({ imports: [registerModels()] })
    class UsersModule {}

    @Module({ imports: [registerModels()] })
    class OrdersModule {}

    expect(loadError(UsersModule, OrdersModule)).toBe(
      '[Miia] PaprModel(users) is provided by both PaprFeatureModule in UsersModule and ' +
        'PaprFeatureModule in OrdersModule - configure it once, import that result in one module and re-export it',
    )
  })

  it('names a provider listed twice in one module', () => {
    @Injectable()
    class MailService {}

    @Module({ providers: [MailService, MailService] })
    class UsersModule {}

    expect(loadError(UsersModule)).toBe('[Miia] MailService is listed twice in UsersModule providers')
  })
})

describe('entry owner', () => {
  it('is the declaring module for providers, controllers and the module class', () => {
    @Injectable()
    class UsersService {}

    @Controller('/users')
    class UsersController {
      @Get('/')
      list(_ctx: RequestContext) {
        return []
      }
    }

    @Module({ controllers: [UsersController], providers: [UsersService] })
    class UsersModule {}

    const ConfigLikeModule = makeConfigLike()
    const EXTRA = createToken<string>('EXTRA')
    const app = new Miia({ logger: false })
      .provide({ token: EXTRA, factory: () => 'extra' })
      .register(UsersModule, ConfigLikeModule.configure())
    const graph = loaded(app)
    const users = nodeOf(graph, 'UsersModule')

    expect(ownerOf(app, UsersService)).toBe(users)
    expect(ownerOf(app, UsersController)).toBe(users)
    expect(ownerOf(app, UsersModule)).toBe(users)
    expect(ownerOf(app, CONFIG)).toBe(nodeOf(graph, 'ConfigLikeModule'))
    expect(ownerOf(app, EXTRA)).toBeNull()
    expect(ownerOf(app, Router)).toBeNull()
  })

  it('stays with the declaring module when a provider or a controller is overridden', () => {
    @Injectable()
    class UsersService {}

    @Controller('/users')
    class UsersController {
      @Get('/')
      list(_ctx: RequestContext) {
        return []
      }
    }

    @Module({ controllers: [UsersController], providers: [UsersService] })
    class UsersModule {}

    const fakeController = Object.create(UsersController.prototype) as UsersController
    const app = new Miia({ logger: false }).register(
      UsersModule,
      overrideProvider(UsersService, () => ({})),
      overrideProvider(UsersController, () => fakeController),
    )
    const users = nodeOf(loaded(app), 'UsersModule')

    expect(app.get(UsersController)).toBe(fakeController)
    expect(ownerOf(app, UsersService)).toBe(users)
    expect(ownerOf(app, UsersController)).toBe(users)
  })
})

describe('provide() of a token a module declares (B18)', () => {
  it('throws with the override() advice', () => {
    @Injectable()
    class UsersService {}

    @Module({ providers: [UsersService] })
    class UsersModule {}

    const app = new Miia({ logger: false }).provide(UsersService).register(UsersModule)

    expect(thrownBy(() => loaded(app)).message).toBe(
      '[Miia] provide(UsersService): UsersService is declared by UsersModule - replace it with override() instead',
    )
  })

  it('names the host of a configured module', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({ imports: [ConfigLikeModule.configure()] })
    class AppModule {}

    const app = new Miia({ logger: false }).provide({ token: CONFIG, factory: () => 'mock' }).register(AppModule)

    expect(thrownBy(() => loaded(app)).message).toStartWith(
      '[Miia] provide(CONFIG): CONFIG is declared by ConfigLikeModule in AppModule',
    )
  })
})
