import { describe, expect, it } from 'bun:test'
import type { ConfiguredModule, RequestContext } from '../src/index.js'
import {
  Controller,
  createToken,
  Get,
  inject,
  Injectable,
  Miia,
  Module,
  overrideProvider,
  provider,
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

async function initError(app: Miia): Promise<Error> {
  try {
    await app.init()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected init() to fail')
}

const CONFIG = createToken<string>('CONFIG')
const NAMED = { MAIN: createToken<string>('MAIN'), LOGS: createToken<string>('LOGS') }

// A dynamic module the way packages write one: no @Module, a static configure().
function makeConfigLike() {
  class ConfigLikeModule {
    static configure(value: string, name?: keyof typeof NAMED): ConfiguredModule {
      const token = name ? NAMED[name] : CONFIG
      return {
        module: ConfigLikeModule,
        providers: [{ token, factory: () => value }],
        exports: [token],
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

  it('rejects one configured object imported by two modules (R8)', () => {
    const ConfigLikeModule = makeConfigLike()
    const shared = ConfigLikeModule.configure('shared')

    @Module({ imports: [shared] })
    class ModuleA {}

    @Module({ imports: [shared] })
    class ModuleB {}

    const app = new Miia({ logger: false }).register(ModuleA, ModuleB)

    const err = thrownBy(() => app.get(CONFIG))
    expect(err.message).toBe(
      '[Miia] The same configured module ConfigLikeModule is imported by ModuleA and ModuleB - ' +
        'import it once and re-export it from that module, or make it global',
    )
    expect(err.constructor).toBe(Error)
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

describe('a module class configured under several names', () => {
  type Name = 'a' | 'b'

  it('shares its own providers: one instance for every name', async () => {
    @Injectable()
    class Helper {}

    const PER_NAME = { a: createToken<Helper>('PerName(a)'), b: createToken<Helper>('PerName(b)') }

    @Module({ providers: [Helper], exports: [Helper] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        const token = PER_NAME[name]
        return { module: Dyn, name, providers: [provider(token, () => inject(Helper))], exports: [token] }
      }
    }

    @Module({ imports: [Dyn.configure('a'), Dyn.configure('b')] })
    class RootModule {}

    const app = new Miia({ logger: false }).register(RootModule)
    await app.init()

    const helper = app.get(Helper)
    expect(helper).toBeInstanceOf(Helper)
    expect(app.get(PER_NAME.a)).toBe(helper)
    expect(app.get(PER_NAME.b)).toBe(helper)
  })

  it('lets an importer of each name see its own providers through exports', async () => {
    @Injectable()
    class Helper {}

    @Module({ providers: [Helper], exports: [Helper] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    @Injectable()
    class UserA {
      helper = inject(Helper)
    }

    @Injectable()
    class UserB {
      helper = inject(Helper)
    }

    @Module({ imports: [Dyn.configure('a')], providers: [UserA] })
    class FeatureA {}

    @Module({ imports: [Dyn.configure('b')], providers: [UserB] })
    class FeatureB {}

    const app = new Miia({ logger: false }).register(FeatureA, FeatureB)
    await app.init()

    expect(app.get(UserA).helper).toBe(app.get(Helper))
    expect(app.get(UserB).helper).toBe(app.get(Helper))
  })

  it('checks what its own provider injects from every name, whatever the order of imports', async () => {
    const X = createToken<string>('X')

    @Module({ providers: [provider(X, () => 'x')], exports: [X] })
    class XModule {}

    @Injectable()
    class Helper {
      x = inject(X)
    }

    @Module({ providers: [Helper] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    // Only HostA imports XModule: Dyn (name 'a') sees X through its host, Dyn (name 'b') does not.
    @Module({ imports: [XModule, Dyn.configure('a')] })
    class HostA {}

    @Module({ imports: [Dyn.configure('b')] })
    class HostB {}

    @Module({ imports: [HostA, HostB] })
    class RootAB {}

    @Module({ imports: [HostB, HostA] })
    class RootBA {}

    const ab = await initError(new Miia({ logger: false }).register(RootAB))
    const ba = await initError(new Miia({ logger: false }).register(RootBA))
    expect(ab.message).toBe(
      '[Miia] 1 module boundary violation:\n\n' +
        "Helper (Dyn (name 'b') in HostB) injects X (XModule):\n" +
        '  - add XModule to HostB `imports`\n\n' +
        'Docs: /docs/core-concepts/modules#boundaries',
    )
    expect(ba.message).toBe(ab.message)
  })

  it('regression: rejects a provider listed twice in its own providers', () => {
    @Injectable()
    class Helper {}

    @Module({ providers: [Helper, Helper] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    const app = new Miia({ logger: false }).register(Dyn.configure('a'), Dyn.configure('b'))

    expect(thrownBy(() => app.get(Helper)).message).toBe(
      "[Miia] Helper is listed twice in Dyn (name 'a') in register() providers",
    )
  })

  it('regression: does not merge its own provider with the same token from a configure() result', () => {
    @Injectable()
    class Helper {}

    @Module({ providers: [Helper] })
    class Dyn {
      static configure(name: Name, withHelper = false): ConfiguredModule {
        return { module: Dyn, name, providers: withHelper ? [Helper] : [] }
      }
    }

    // In one name: the configure() result and @Module list the same token.
    const same = new Miia({ logger: false }).register(Dyn.configure('a', true))
    expect(thrownBy(() => same.get(Helper)).message).toBe(
      "[Miia] Helper is listed twice in Dyn (name 'a') in register() providers",
    )

    // Across names: @Module of the first name, the configure() result of the second.
    const across = new Miia({ logger: false }).register(Dyn.configure('a'), Dyn.configure('b', true))
    expect(thrownBy(() => across.get(Helper)).message).toBe(
      "[Miia] Helper is provided by both Dyn (name 'a') in register() and Dyn (name 'b') in register() - " +
        'configure it once, import that result in one module and re-export it',
    )
  })

  it('regression: rejects the same token in the providers of two configure() results', () => {
    const SHARED = createToken<string>('Shared')

    @Module({})
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name, providers: [provider(SHARED, () => name)] }
      }
    }

    const app = new Miia({ logger: false }).register(Dyn.configure('a'), Dyn.configure('b'))

    expect(thrownBy(() => app.get(SHARED)).message).toBe(
      "[Miia] Shared is provided by both Dyn (name 'a') in register() and Dyn (name 'b') in register() - " +
        'configure it once, import that result in one module and re-export it',
    )
  })

  it('mounts its controllers once, with an override applied once', async () => {
    @Controller('/dyn')
    class DynController {
      @Get('/')
      read(_ctx: RequestContext) {
        return { from: 'real' }
      }
    }

    @Module({ controllers: [DynController] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    @Module({ imports: [Dyn.configure('a'), Dyn.configure('b')] })
    class RootModule {}

    const real = new Miia({ logger: false }).register(RootModule)
    await real.init()
    const res = await get(real, '/dyn')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ from: 'real' })

    let built = 0
    const fake = new Miia({ logger: false }).register(
      RootModule,
      overrideProvider(DynController, () => {
        built++
        return { read: () => ({ from: 'fake' }) }
      }),
    )
    await fake.init()
    const faked = await get(fake, '/dyn')
    expect(await faked.json()).toEqual({ from: 'fake' })
    expect(built).toBe(1)
  })

  it('checks what its controller injects from every name, whatever the order of imports', async () => {
    const X = createToken<string>('X')

    @Module({ providers: [provider(X, () => 'x')], exports: [X] })
    class XModule {}

    @Controller('/dyn')
    class DynController {
      x = inject(X)

      @Get('/')
      read(_ctx: RequestContext) {
        return { x: this.x }
      }
    }

    @Module({ controllers: [DynController] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    @Module({ imports: [XModule, Dyn.configure('a')] })
    class HostA {}

    @Module({ imports: [Dyn.configure('b')] })
    class HostB {}

    @Module({ imports: [HostA, HostB] })
    class RootAB {}

    @Module({ imports: [HostB, HostA] })
    class RootBA {}

    const ab = await initError(new Miia({ logger: false }).register(RootAB))
    const ba = await initError(new Miia({ logger: false }).register(RootBA))
    expect(ab.message).toContain("DynController (Dyn (name 'b') in HostB) injects X (XModule):")
    expect(ba.message).toBe(ab.message)
  })

  it('checks what the module class itself injects from every name, whatever the order of imports', async () => {
    const X = createToken<string>('X')

    @Module({ providers: [provider(X, () => 'x')], exports: [X] })
    class XModule {}

    @Module({})
    class Dyn {
      x = inject(X)

      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    @Module({ imports: [XModule, Dyn.configure('a')] })
    class HostA {}

    @Module({ imports: [Dyn.configure('b')] })
    class HostB {}

    @Module({ imports: [HostA, HostB] })
    class RootAB {}

    @Module({ imports: [HostB, HostA] })
    class RootBA {}

    const ab = await initError(new Miia({ logger: false }).register(RootAB))
    const ba = await initError(new Miia({ logger: false }).register(RootBA))
    expect(ab.message).toContain("Dyn (Dyn (name 'b') in HostB) injects X (XModule):")
    expect(ba.message).toBe(ab.message)
  })

  it('checks a declared guard of its controller from every name, whatever the order of imports', async () => {
    @Injectable()
    class G {
      canActivate() {
        return true
      }
    }

    @Module({ providers: [G], exports: [G] })
    class GModule {}

    @Controller('/dyn')
    @UseGuard(G)
    class DynController {
      @Get('/')
      read(_ctx: RequestContext) {
        return {}
      }
    }

    @Module({ controllers: [DynController] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    @Module({ imports: [GModule, Dyn.configure('a')] })
    class HostA {}

    @Module({ imports: [Dyn.configure('b')] })
    class HostB {}

    @Module({ imports: [HostA, HostB] })
    class RootAB {}

    @Module({ imports: [HostB, HostA] })
    class RootBA {}

    const ab = await initError(new Miia({ logger: false }).register(RootAB))
    const ba = await initError(new Miia({ logger: false }).register(RootBA))
    expect(ab.message).toBe(
      '[Miia] 1 module boundary violation:\n\n' +
        "DynController (Dyn (name 'b') in HostB) uses G (GModule):\n" +
        '  - add GModule to HostB `imports`\n\n' +
        'Docs: /docs/core-concepts/modules#boundaries',
    )
    expect(ba.message).toBe(ab.message)
  })

  it('checks what a guard of its controller no module declares injects from every name', async () => {
    const X = createToken<string>('X')

    @Module({ providers: [provider(X, () => 'x')], exports: [X] })
    class XModule {}

    class PeekGuard {
      x = inject(X)
      canActivate() {
        return true
      }
    }

    @Controller('/dyn')
    @UseGuard(PeekGuard)
    class DynController {
      @Get('/')
      read(_ctx: RequestContext) {
        return {}
      }
    }

    @Module({ controllers: [DynController] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    @Module({ imports: [XModule, Dyn.configure('a')] })
    class HostA {}

    @Module({ imports: [Dyn.configure('b')] })
    class HostB {}

    @Module({ imports: [HostA, HostB] })
    class RootAB {}

    @Module({ imports: [HostB, HostA] })
    class RootBA {}

    const ab = await initError(new Miia({ logger: false }).register(RootAB))
    const ba = await initError(new Miia({ logger: false }).register(RootBA))
    expect(ab.message).toBe(
      '[Miia] 1 module boundary violation:\n\n' +
        "PeekGuard (guard of DynController in Dyn (name 'b') in HostB) injects X (XModule):\n" +
        '  - add XModule to HostB `imports`\n\n' +
        'Docs: /docs/core-concepts/modules#boundaries',
    )
    expect(ba.message).toBe(ab.message)
  })

  it('rejects its controllers under two prefixes', () => {
    @Controller('/dyn')
    class DynController {
      @Get('/')
      read(_ctx: RequestContext) {
        return {}
      }
    }

    @Module({ controllers: [DynController] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    @Module({ prefix: '/x', imports: [Dyn.configure('a')] })
    class HostA {}

    @Module({ prefix: '/y', imports: [Dyn.configure('b')] })
    class HostB {}

    @Module({ imports: [Dyn.configure('b')] })
    class PlainHost {}

    const prefixed = new Miia({ logger: false }).register(HostA, HostB)
    expect(thrownBy(() => prefixed.get(Dyn)).message).toBe(
      "[Miia] Dyn (name 'b') resolves its controllers under /y, but Dyn (name 'a') already mounted them under /x - " +
        'a module class configured under several names mounts its controllers once; give them one prefix',
    )

    const plain = new Miia({ logger: false }).register(HostA, PlainHost)
    expect(thrownBy(() => plain.get(Dyn)).message).toBe(
      "[Miia] Dyn (name 'b') resolves its controllers under /, but Dyn (name 'a') already mounted them under /x - " +
        'a module class configured under several names mounts its controllers once; give them one prefix',
    )
  })

  it('imports a configure() result in its own imports once, for every name', async () => {
    const OTHER = createToken<string>('Other')
    const PER_NAME = { a: createToken<string>('PerName(a)'), b: createToken<string>('PerName(b)') }

    class OtherModule {
      static configure(value: string): ConfiguredModule {
        return { module: OtherModule, providers: [provider(OTHER, () => value)], exports: [OTHER] }
      }
    }

    @Module({ imports: [OtherModule.configure('other')] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        const token = PER_NAME[name]
        return { module: Dyn, name, providers: [provider(token, (resolve) => resolve(OTHER))], exports: [token] }
      }
    }

    @Module({ imports: [Dyn.configure('a'), Dyn.configure('b')] })
    class RootModule {}

    const app = new Miia({ logger: false }).register(RootModule)
    await app.init()

    expect(app.get(PER_NAME.a)).toBe('other')
    expect(app.get(PER_NAME.b)).toBe('other')
  })
})
