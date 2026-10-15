import { describe, expect, it } from 'bun:test'
import type { ConfiguredModule, RequestContext } from '../src/index.js'
import { Controller, createToken, Get, inject, Injectable, Miia, Module } from '../src/index.js'

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
const NAMED = { MAIN: createToken<string>('MAIN'), LOGS: createToken<string>('LOGS') }

// A dynamic module the way packages write one: no @Module, a static configure().
function makeConfigLike() {
  class ConfigLikeModule {
    static configure(value: string, name?: keyof typeof NAMED): ConfiguredModule {
      return {
        module: ConfigLikeModule,
        providers: [{ token: name ? NAMED[name] : CONFIG, factory: () => value }],
        name,
      }
    }
  }
  return ConfigLikeModule
}

describe('configured modules', () => {
  it('resolves a bare import to the configuration registered after it (P11)', async () => {
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

    @Module({ imports: [FeatureModule, ConfigLikeModule.configure('root')] })
    class RootModule {}

    const app = new Miia({ logger: false }).register(RootModule)

    const res = await get(app, '/feature')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ config: 'root' })
  })

  it('resolves a bare import to a configuration in a later register() call', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({ imports: [ConfigLikeModule] })
    class FeatureModule {}

    const app = new Miia({ logger: false }).register(FeatureModule).register(ConfigLikeModule.configure('later'))

    expect(app.get(CONFIG)).toBe('later')
  })

  it('rejects two configurations of one module without a name (P12)', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({ imports: [ConfigLikeModule.configure('feature')] })
    class FeatureModule {}

    @Module({ imports: [ConfigLikeModule.configure('root'), FeatureModule] })
    class RootModule {}

    const app = new Miia({ logger: false }).register(RootModule)

    const err = thrownBy(() => app.get(CONFIG))
    expect(err.message).toBe(
      '[Miia] ConfigLikeModule is configured twice (RootModule, FeatureModule) - configure it once; ' +
        'for another connection use a different name; ' +
        'in tests, replace it with TestApp.override(ConfigLikeModule, ConfigLikeModule.configure(...))',
    )
    expect(err.constructor).toBe(Error)
  })

  it('names register() as the host of a top-level configuration', () => {
    const ConfigLikeModule = makeConfigLike()
    const app = new Miia({ logger: false }).register(ConfigLikeModule.configure('a'), ConfigLikeModule.configure('b'))

    expect(() => app.get(CONFIG)).toThrow('[Miia] ConfigLikeModule is configured twice (register(), register())')
  })

  it('registers configurations of one module with different names', () => {
    const ConfigLikeModule = makeConfigLike()

    @Module({ imports: [ConfigLikeModule.configure('main', 'MAIN'), ConfigLikeModule.configure('logs', 'LOGS')] })
    class RootModule {}

    const app = new Miia({ logger: false }).register(RootModule)

    expect(app.get(NAMED.MAIN)).toBe('main')
    expect(app.get(NAMED.LOGS)).toBe('logs')
  })

  it('rejects two configurations with the same name, and names the pair', () => {
    const ConfigLikeModule = makeConfigLike()
    const app = new Miia({ logger: false }).register(
      ConfigLikeModule.configure('a', 'MAIN'),
      ConfigLikeModule.configure('b', 'MAIN'),
    )

    expect(() => app.get(NAMED.MAIN)).toThrow("[Miia] ConfigLikeModule (name 'MAIN') is configured twice")
  })

  it('treats one configured object imported by two modules as one module', () => {
    const ConfigLikeModule = makeConfigLike()
    const shared = ConfigLikeModule.configure('shared')

    @Module({ imports: [shared] })
    class ModuleA {}

    @Module({ imports: [shared] })
    class ModuleB {}

    const app = new Miia({ logger: false }).register(ModuleA, ModuleB)

    expect(app.get(CONFIG)).toBe('shared')
  })

  it('treats a bare import and its configuration as one module', () => {
    @Injectable()
    class OwnService {}

    const DB_URL = createToken<string>('DB_URL')

    @Module({ providers: [OwnService] })
    class DbModule {
      static configure(): ConfiguredModule {
        return { module: DbModule, providers: [{ token: DB_URL, factory: () => 'db://test' }] }
      }
    }

    @Module({ imports: [DbModule] })
    class FeatureModule {}

    // DbModule's own providers would throw Duplicate if it were processed twice
    const app = new Miia({ logger: false }).register(FeatureModule, DbModule.configure())

    expect(app.get(DB_URL)).toBe('db://test')
    expect(app.get(OwnService)).toBeInstanceOf(OwnService)
  })
})
