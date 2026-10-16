import { describe, expect, it } from 'bun:test'
import type { ConfiguredModule, Constructor, RequestContext, Resolve, Token } from '../src/index.js'
import {
  Controller,
  createLazyProxy,
  createToken,
  forwardRef,
  Get,
  inject,
  Injectable,
  injectOptional,
  Miia,
  Module,
  provider,
  UseGuard,
} from '../src/index.js'

const DOCS = 'Docs: /docs/core-concepts/modules#boundaries'

function report(...blocks: string[]): string {
  const count = `${blocks.length} module boundary violation${blocks.length === 1 ? '' : 's'}`
  return [`[Miia] ${count}:`, ...blocks, DOCS].join('\n\n')
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

function request(app: Miia, path: string): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`http://localhost${path}`)))
}

// A dynamic module the way packages write one: no @Module, a static configure().
function makeConfigLike() {
  const OPTIONS = createToken<string>('Options')
  const INTERNAL = createToken<string>('Internal')
  class ConfigLikeModule {
    static configure(options: { global?: boolean; name?: string; exportsNothing?: boolean } = {}): ConfiguredModule {
      return {
        module: ConfigLikeModule,
        name: options.name,
        global: options.global,
        providers: [provider(OPTIONS, () => 'options'), provider(INTERNAL, () => 'internal')],
        exports: options.exportsNothing ? undefined : [OPTIONS],
      }
    }
  }
  return { ConfigLikeModule, OPTIONS, INTERNAL }
}

// configure() takes a factory of its options, like resolveOptions() in the packages.
function makeFactoryLike() {
  const OPTIONS = createToken<string>('Options')
  class FactoryLikeModule {
    static configure(factory: (resolve: Resolve) => string): ConfiguredModule {
      return {
        module: FactoryLikeModule,
        providers: [provider(OPTIONS, (resolve) => factory(resolve))],
        exports: [OPTIONS],
      }
    }
  }
  return { FactoryLikeModule, OPTIONS }
}

// configure() owns a connection; register() returns an anonymous module whose models resolve it, like papr/mongoose.
function makeStoreLike() {
  const CONNECTION = createToken<{ name: string }>('StoreConnection')
  class StoreModule {
    static configure(options: { global?: boolean } = {}): ConfiguredModule {
      return {
        module: StoreModule,
        global: options.global,
        providers: [provider(CONNECTION, () => ({ name: 'conn' }))],
        exports: [CONNECTION],
      }
    }

    static register(models: Token<object>[]): ConfiguredModule {
      const FeatureModule = class {} as Constructor
      Object.defineProperty(FeatureModule, 'name', {
        value: `StoreModule.register([${models.map((model) => model.name).join(', ')}])`,
      })
      return {
        module: FeatureModule,
        providers: models.map((token) => provider(token, (resolve) => ({ connection: resolve(CONNECTION) }))),
        exports: [...models],
      }
    }
  }
  return { StoreModule, CONNECTION }
}

describe('module boundaries', () => {
  describe('R4: imports and exports', () => {
    it('reports a provider of an import that is not exported', async () => {
      @Injectable()
      class UsersService {}

      @Module({ providers: [UsersService] })
      class UsersModule {}

      @Injectable()
      class OrdersService {
        users = inject(UsersService)
      }

      @Module({ imports: [UsersModule], providers: [OrdersService] })
      class OrdersModule {}

      const error = await initError(new Miia({ logger: false }).register(OrdersModule))
      expect(error.message).toBe(
        report(
          'OrdersService (OrdersModule) injects UsersService (UsersModule):\n' +
            '  - add UsersService to UsersModule `exports`',
        ),
      )
    })

    it('reports an export of a module that is not imported', async () => {
      @Injectable()
      class UsersService {}

      @Module({ providers: [UsersService], exports: [UsersService] })
      class UsersModule {}

      @Injectable()
      class OrdersService {
        users = inject(UsersService)
      }

      @Module({ providers: [OrdersService] })
      class OrdersModule {}

      const error = await initError(new Miia({ logger: false }).register(UsersModule, OrdersModule))
      expect(error.message).toBe(
        report(
          'OrdersService (OrdersModule) injects UsersService (UsersModule):\n' +
            '  - add UsersModule to OrdersModule `imports`',
        ),
      )
    })

    it('sees an import that exports the provider', async () => {
      @Injectable()
      class UsersService {}

      @Module({ providers: [UsersService], exports: [UsersService] })
      class UsersModule {}

      @Injectable()
      class OrdersService {
        users = inject(UsersService)
      }

      @Module({ imports: [UsersModule], providers: [OrdersService] })
      class OrdersModule {}

      const app = new Miia({ logger: false }).register(OrdersModule)
      await app.init()
      expect(app.get(OrdersService).users).toBeInstanceOf(UsersService)
      await app.destroy()
    })

    it('sees a provider re-exported along a chain of modules', async () => {
      @Injectable()
      class MailService {}

      @Module({ providers: [MailService], exports: [MailService] })
      class MailModule {}

      @Module({ imports: [MailModule], exports: [MailModule] })
      class NotificationsModule {}

      @Injectable()
      class UsersService {
        mail = inject(MailService)
      }

      @Module({ imports: [NotificationsModule], providers: [UsersService] })
      class UsersModule {}

      const app = new Miia({ logger: false }).register(UsersModule)
      await app.init()
      expect(app.get(UsersService).mail).toBeInstanceOf(MailService)
      await app.destroy()
    })

    it('sees the exports of a global module without importing it', async () => {
      @Injectable()
      class MailService {}

      @Module({ global: true, providers: [MailService], exports: [MailService] })
      class MailModule {}

      @Injectable()
      class UsersService {
        mail = inject(MailService)
      }

      @Module({ providers: [UsersService] })
      class UsersModule {}

      const app = new Miia({ logger: false }).register(MailModule, UsersModule)
      await app.init()
      expect(app.get(UsersService).mail).toBeInstanceOf(MailService)
      await app.destroy()
    })

    it('sees what a global module re-exports', async () => {
      const { ConfigLikeModule, OPTIONS } = makeConfigLike()
      const config = ConfigLikeModule.configure()

      @Module({ global: true, imports: [config], exports: [config] })
      class CoreModule {}

      @Injectable()
      class UsersService {
        options = inject(OPTIONS)
      }

      @Module({ providers: [UsersService] })
      class UsersModule {}

      const app = new Miia({ logger: false }).register(CoreModule, UsersModule)
      await app.init()
      expect(app.get(UsersService).options).toBe('options')
      await app.destroy()
    })

    it('sees the exports of each other across a forwardRef cycle', async () => {
      @Injectable()
      class UsersHelper {}

      @Injectable()
      class OrdersHelper {}

      @Injectable()
      class UsersService {
        orders = inject(OrdersHelper)
      }

      @Injectable()
      class OrdersService {
        users = inject(UsersHelper)
      }

      @Module({
        imports: [forwardRef(() => OrdersModule)],
        providers: [UsersHelper, UsersService],
        exports: [UsersHelper],
      })
      class UsersModule {}

      @Module({
        imports: [forwardRef(() => UsersModule)],
        providers: [OrdersHelper, OrdersService],
        exports: [OrdersHelper],
      })
      class OrdersModule {}

      const app = new Miia({ logger: false }).register(UsersModule)
      await app.init()
      expect(app.get(UsersService).orders).toBeInstanceOf(OrdersHelper)
      expect(app.get(OrdersService).users).toBeInstanceOf(UsersHelper)
      await app.destroy()
    })
  })

  describe('configured modules', () => {
    it('R5a: names a configure() that exports nothing', async () => {
      const { ConfigLikeModule, OPTIONS } = makeConfigLike()

      @Injectable()
      class UsersService {
        options = inject(OPTIONS)
      }

      @Module({ imports: [ConfigLikeModule.configure({ exportsNothing: true })], providers: [UsersService] })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule))
      expect(error.message).toBe(
        report(
          'UsersService (AppModule) injects Options (ConfigLikeModule in AppModule):\n' +
            '  - ConfigLikeModule.configure() exports nothing - its author should list its public providers in exports',
        ),
      )
    })

    it('names a provider configure() does not export', async () => {
      const { ConfigLikeModule, INTERNAL } = makeConfigLike()

      @Injectable()
      class UsersService {
        internal = inject(INTERNAL)
      }

      @Module({ imports: [ConfigLikeModule.configure()], providers: [UsersService] })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule))
      expect(error.message).toBe(
        report(
          'UsersService (AppModule) injects Internal (ConfigLikeModule in AppModule):\n' +
            '  - ConfigLikeModule.configure() does not export Internal',
        ),
      )
    })

    it('R6a: advises { global: true } or a bare import for a module configured elsewhere', async () => {
      const { ConfigLikeModule, OPTIONS } = makeConfigLike()

      @Injectable()
      class UsersService {
        options = inject(OPTIONS)
      }

      @Module({ providers: [UsersService] })
      class UsersModule {}

      @Module({ imports: [ConfigLikeModule.configure(), UsersModule] })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule))
      expect(error.message).toBe(
        report(
          'UsersService (UsersModule) injects Options (ConfigLikeModule in AppModule), which is not global:\n' +
            '  - make it global: ConfigLikeModule.configure(options, { global: true })\n' +
            '  - or add ConfigLikeModule to UsersModule `imports`',
        ),
      )
    })

    it('R6a: a bare import reaches the configuration of the root', async () => {
      const { ConfigLikeModule, OPTIONS } = makeConfigLike()

      @Injectable()
      class UsersService {
        options = inject(OPTIONS)
      }

      @Module({ imports: [ConfigLikeModule], providers: [UsersService] })
      class UsersModule {}

      @Module({ imports: [ConfigLikeModule.configure(), UsersModule] })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      await app.init()
      expect(app.get(UsersService).options).toBe('options')
      await app.destroy()
    })

    it('R6a: a named configuration has no bare import to advise', async () => {
      const { ConfigLikeModule, OPTIONS } = makeConfigLike()

      @Injectable()
      class UsersService {
        options = inject(OPTIONS)
      }

      @Module({ providers: [UsersService] })
      class UsersModule {}

      @Module({ imports: [ConfigLikeModule.configure({ name: 'analytics' }), UsersModule] })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule))
      expect(error.message).toBe(
        report(
          "UsersService (UsersModule) injects Options (ConfigLikeModule (name 'analytics') in AppModule), which is not global:\n" +
            "  - make it global: ConfigLikeModule.configure(options, { name: 'analytics', global: true })\n" +
            '  - or import that configure() result in UsersModule only and re-export it',
        ),
      )
    })

    it('R8: the factory of a configured module sees the private providers of its host', async () => {
      const { FactoryLikeModule, OPTIONS } = makeFactoryLike()

      @Injectable()
      class EnvConfig {
        value = 'env'
      }

      @Module({
        imports: [FactoryLikeModule.configure((resolve) => resolve(EnvConfig).value)],
        providers: [EnvConfig],
      })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      await app.init()
      expect(app.get(OPTIONS)).toBe('env')
      await app.destroy()
    })

    it('R8: the factory does not see the private providers of a module other than its host', async () => {
      const { FactoryLikeModule } = makeFactoryLike()

      @Injectable()
      class Secret {}

      @Module({ providers: [Secret] })
      class SiblingModule {}

      @Module({ imports: [SiblingModule, FactoryLikeModule.configure((resolve) => String(resolve(Secret)))] })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule))
      expect(error.message).toBe(
        report(
          'Options (FactoryLikeModule in AppModule) injects Secret (SiblingModule):\n' +
            '  - add Secret to SiblingModule `exports`',
        ),
      )
    })

    it('R8: a configure() result passed to register() is hosted by the root', async () => {
      const { FactoryLikeModule } = makeFactoryLike()

      @Injectable()
      class EnvConfig {
        value = 'env'
      }

      @Module({ providers: [EnvConfig] })
      class AppModule {}

      const error = await initError(
        new Miia({ logger: false }).register(
          AppModule,
          FactoryLikeModule.configure((resolve) => resolve(EnvConfig).value),
        ),
      )
      expect(error.message).toBe(
        report(
          'Options (FactoryLikeModule in register()) injects EnvConfig (AppModule):\n' +
            '  - add EnvConfig to AppModule `exports`',
        ),
      )
    })

    it('R8: a register() model reaches a non-global configure() through the bare import of its host', async () => {
      const { StoreModule } = makeStoreLike()
      const USER = createToken<object>('User')

      @Module({ imports: [StoreModule, StoreModule.register([USER])] })
      class UsersModule {}

      @Module({ imports: [StoreModule.configure(), UsersModule] })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      await app.init()
      expect(app.get(USER)).toEqual({ connection: { name: 'conn' } })
      await app.destroy()
    })

    it('R8: without the bare import the model is reported from its host', async () => {
      const { StoreModule } = makeStoreLike()
      const USER = createToken<object>('User')

      @Module({ imports: [StoreModule.register([USER])] })
      class UsersModule {}

      @Module({ imports: [StoreModule.configure(), UsersModule] })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule))
      expect(error.message).toBe(
        report(
          'User (StoreModule.register([User]) in UsersModule) injects StoreConnection (StoreModule in AppModule), which is not global:\n' +
            '  - make it global: StoreModule.configure(options, { global: true })\n' +
            '  - or add StoreModule to UsersModule `imports`',
        ),
      )
    })
  })

  describe('R7: a factory resolve is bound to its entry', () => {
    it('checks a late call from a lazy proxy against its own module, not the top of the stack', async () => {
      const DB = createToken<{ query(): string }>('Db')

      @Injectable()
      class DbService {
        db = { query: () => 'rows' }
      }

      @Module({
        providers: [
          DbService,
          provider(DB, (resolve) => createLazyProxy(() => resolve(DbService).db), { deps: [DbService] }),
        ],
        exports: [DB],
      })
      class DbModule {}

      @Injectable()
      class UsersRepository {
        db = inject(DB)
        // Resolves the proxy while UsersRepository is on top of the stack
        rows = this.db.query()
      }

      @Module({ imports: [DbModule], providers: [UsersRepository] })
      class UsersModule {}

      const app = new Miia({ logger: false }).register(UsersModule)
      await app.init()
      expect(app.get(UsersRepository).rows).toBe('rows')
      await app.destroy()
    })

    it('throws a late violation at once, outside the start-up window', async () => {
      const DB = createToken<{ value: number }>('Db')
      const SECRET = createToken<{ value: number }>('Secret')

      @Module({ providers: [provider(SECRET, () => ({ value: 1 }))] })
      class SecretModule {}

      @Module({
        imports: [SecretModule],
        providers: [provider(DB, (resolve) => createLazyProxy(() => resolve(SECRET)))],
        exports: [DB],
      })
      class DbModule {}

      @Injectable()
      class Other {}

      @Module({ imports: [DbModule], providers: [Other] })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      await app.init()
      expect(thrownBy(() => app.get(DB).value).message).toBe(
        report('Db (DbModule) injects Secret (SecretModule):\n  - add Secret to SecretModule `exports`'),
      )
      expect(app.get(Other)).toBeInstanceOf(Other)
      await app.destroy()
    })

    it('checks S4 against the bound entry, not the request provider being constructed', async () => {
      const HOLDER = createToken<object>('Holder')
      const THING = createToken<object>('RequestThing')
      let saved: Resolve | undefined

      @Injectable({ scope: 'request' })
      class RequestService {
        thing = saved!(THING)
      }

      @Controller('/')
      class Ctrl {
        @Get()
        get(ctx: RequestContext) {
          try {
            ctx.resolve(RequestService)
            return { error: null }
          } catch (err) {
            return { error: (err as Error).message }
          }
        }
      }

      @Module({
        controllers: [Ctrl],
        providers: [
          provider(HOLDER, (resolve) => {
            saved = resolve
            return {}
          }),
          provider(THING, () => ({}), { scope: 'request' }),
          RequestService,
        ],
      })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      await app.init()
      const body = (await (await request(app, '/')).json()) as { error: string | null }
      expect(body.error).toStartWith('[Miia] Holder (singleton) injects request-scoped RequestThing - ')
      await app.destroy()
    })
  })

  it('R17a: reports a token in deps that the owner cannot see', async () => {
    const LAZY = createToken<object>('Lazy')

    @Injectable()
    class Hidden {}

    @Module({ providers: [Hidden] })
    class OtherModule {}

    @Module({ imports: [OtherModule], providers: [provider(LAZY, () => ({}), { deps: [Hidden] })] })
    class AppModule {}

    const error = await initError(new Miia({ logger: false }).register(AppModule))
    expect(error.message).toBe(
      report('Lazy (AppModule) lists Hidden (OtherModule) in deps:\n  - add Hidden to OtherModule `exports`'),
    )
  })

  describe('R20: the start-up report', () => {
    it('collects the graph and every singleton into one report before any onInit()', async () => {
      const events: string[] = []
      const { ConfigLikeModule, OPTIONS } = makeConfigLike()

      @Injectable()
      class UsersService {
        onInit() {
          events.push('UsersService.onInit')
        }
      }

      @Module({ providers: [UsersService] })
      class UsersModule {}

      @Injectable()
      class OrdersService {
        users = inject(UsersService)
      }

      @Controller('/orders')
      class OrdersController {
        orders = inject(OrdersService)
      }

      @Module({ controllers: [OrdersController], providers: [OrdersService] })
      class OrdersModule {}

      // Nothing pulls it: it is built with the other singletons
      @Injectable()
      class ReportsService {
        options = inject(OPTIONS)
      }

      @Module({ providers: [ReportsService] })
      class ReportsModule {}

      @Module({ imports: [ConfigLikeModule.configure(), UsersModule, OrdersModule, ReportsModule] })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule))
      expect(error.message).toBe(
        '[Miia] 2 module boundary violations:\n' +
          '\n' +
          'OrdersService (OrdersModule) injects UsersService (UsersModule):\n' +
          '  - add UsersService to UsersModule `exports`\n' +
          '  - add UsersModule to OrdersModule `imports`\n' +
          '\n' +
          'ReportsService (ReportsModule) injects Options (ConfigLikeModule in AppModule), which is not global:\n' +
          '  - make it global: ConfigLikeModule.configure(options, { global: true })\n' +
          '  - or add ConfigLikeModule to ReportsModule `imports`\n' +
          '\n' +
          'Docs: /docs/core-concepts/modules#boundaries',
      )
      expect(events).toEqual([])
    })

    it('app.get() before init() reports the graph and the tree of the token, and the app stays dead', async () => {
      @Injectable()
      class UsersService {}

      @Module({ providers: [UsersService] })
      class UsersModule {}

      @Controller('/')
      class OrdersController {
        users = inject(UsersService)
      }

      @Injectable()
      class ReportsService {
        users = inject(UsersService)
      }

      @Module({ controllers: [OrdersController], providers: [ReportsService] })
      class OrdersModule {}

      const app = new Miia({ logger: false }).register(UsersModule, OrdersModule)
      const error = thrownBy(() => app.get(ReportsService))
      const advice = '  - add UsersService to UsersModule `exports`\n  - add UsersModule to OrdersModule `imports`'
      expect(error.message).toBe(
        report(
          `OrdersController (OrdersModule) injects UsersService (UsersModule):\n${advice}`,
          `ReportsService (OrdersModule) injects UsersService (UsersModule):\n${advice}`,
        ),
      )

      expect(thrownBy(() => app.get(UsersService))).toBe(error)
      expect(await initError(app)).toBe(error)
      expect(thrownBy(() => app.get(UsersService))).toBe(error)
      await expect(request(app, '/')).rejects.toBe(error)
    })

    it('appends the violations found so far to "No provider", and the app stays dead', async () => {
      const MISSING = createToken<object>('Missing')

      @Injectable()
      class Hidden {}

      @Module({ providers: [Hidden] })
      class OtherModule {}

      @Controller('/')
      class Ctrl {
        hidden = inject(Hidden)
      }

      @Injectable()
      class Needy {
        missing = inject(MISSING)
      }

      @Module({ imports: [OtherModule], controllers: [Ctrl], providers: [Needy] })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      const error = await initError(app)
      const noProvider = '[Miia] No provider found for token: Missing, required by Needy (AppModule)'
      expect(error.message).toBe(
        `${noProvider}\n\n` +
          'Also found 1 module boundary violation so far:\n\n' +
          'Ctrl (AppModule) injects Hidden (OtherModule):\n' +
          '  - add Hidden to OtherModule `exports`\n\n' +
          DOCS,
      )
      expect((error.cause as Error).message).toBe(noProvider)
      expect(thrownBy(() => app.get(Ctrl))).toBe(error)
    })

    it('appends the violations to an error a factory wraps in its own', async () => {
      const CONNECTION = createToken<object>('Connection')
      const CLIENT = createToken<object>('Client')

      @Injectable()
      class Hidden {}

      @Module({ providers: [Hidden] })
      class OtherModule {}

      @Controller('/')
      class Ctrl {
        hidden = inject(Hidden)
      }

      @Module({
        imports: [OtherModule],
        controllers: [Ctrl],
        providers: [
          provider(CLIENT, (resolve) => {
            try {
              return resolve(CONNECTION)
            } catch {
              throw new Error('[Pkg] Client needs PkgModule.configure()')
            }
          }),
        ],
      })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule))
      expect(error.message).toBe(
        '[Pkg] Client needs PkgModule.configure()\n\n' +
          'Also found 1 module boundary violation so far:\n\n' +
          'Ctrl (AppModule) injects Hidden (OtherModule):\n' +
          '  - add Hidden to OtherModule `exports`\n\n' +
          DOCS,
      )
      expect((error.cause as Error).message).toBe('[Pkg] Client needs PkgModule.configure()')
    })

    it('an error without violations does not kill the app', async () => {
      const MISSING = createToken<object>('Missing')

      @Injectable()
      class UsersService {}

      @Module({ providers: [UsersService] })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      expect(thrownBy(() => app.get(MISSING)).message).toBe('[Miia] No provider found for token: Missing')
      expect(app.get(UsersService)).toBeInstanceOf(UsersService)
      await app.init()
      await app.destroy()
    })
  })

  describe('grouping', () => {
    it('puts the tokens of one module into one block', async () => {
      @Injectable()
      class MailService {}

      @Injectable()
      class SmsService {}

      @Module({ providers: [MailService, SmsService] })
      class NotificationsModule {}

      @Injectable()
      class UsersService {
        mail = inject(MailService)
        sms = inject(SmsService)
      }

      @Module({ imports: [NotificationsModule], providers: [UsersService] })
      class UsersModule {}

      const error = await initError(new Miia({ logger: false }).register(UsersModule))
      expect(error.message).toBe(
        report(
          'UsersService (UsersModule) injects MailService, SmsService (NotificationsModule):\n' +
            '  - add MailService, SmsService to NotificationsModule `exports`',
        ),
      )
    })

    it('prints identical blocks once', async () => {
      @Injectable()
      class Hidden {}

      @Module({ providers: [Hidden] })
      class OtherModule {}

      const makeProbe = () => {
        @Injectable()
        class Probe {
          hidden = inject(Hidden)
        }
        return Probe
      }

      @Module({ imports: [OtherModule], providers: [makeProbe(), makeProbe()] })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule))
      expect(error.message).toBe(
        report('Probe (AppModule) injects Hidden (OtherModule):\n  - add Hidden to OtherModule `exports`'),
      )
    })
  })

  it('R21: a transient built on a request throws at once, and the app stays alive', async () => {
    @Injectable()
    class Hidden {}

    @Module({ providers: [Hidden] })
    class OtherModule {}

    @Injectable({ scope: 'transient' })
    class Formatter {
      hidden = inject(Hidden)
    }

    @Controller('/')
    class Ctrl {
      @Get('format')
      format(ctx: RequestContext) {
        ctx.resolve(Formatter)
        return { ok: true }
      }

      @Get('ok')
      ok() {
        return { ok: true }
      }
    }

    @Module({ imports: [OtherModule], controllers: [Ctrl], providers: [Formatter] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    expect((await request(app, '/format')).status).toBe(500)
    expect((await request(app, '/ok')).status).toBe(200)
    expect(thrownBy(() => app.get(Formatter)).message).toBe(
      report('Formatter (AppModule) injects Hidden (OtherModule):\n  - add Hidden to OtherModule `exports`'),
    )
    await app.destroy()
  })

  describe('R23: injectOptional()', () => {
    it('reports a registered token the module cannot see', async () => {
      @Injectable()
      class Hidden {}

      @Module({ providers: [Hidden] })
      class OtherModule {}

      @Injectable()
      class Probe {
        hidden = injectOptional(Hidden)
      }

      @Module({ imports: [OtherModule], providers: [Probe] })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule))
      expect(error.message).toBe(
        report('Probe (AppModule) injects Hidden (OtherModule):\n  - add Hidden to OtherModule `exports`'),
      )
    })

    it('returns null for a token nothing registers', async () => {
      @Injectable()
      class Probe {
        missing = injectOptional(createToken<object>('Missing'))
      }

      @Module({ providers: [Probe] })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      await app.init()
      expect(app.get(Probe).missing).toBeNull()
      await app.destroy()
    })
  })

  describe('top-level resolution is not checked', () => {
    @Injectable()
    class Hidden {}

    @Injectable({ scope: 'transient' })
    class HiddenTransient {}

    @Module({ providers: [Hidden, HiddenTransient] })
    class OtherModule {}

    @Injectable({ scope: 'request' })
    class Scoped {
      hidden = inject(Hidden)
    }

    @Controller('/')
    class Ctrl {
      @Get('hidden')
      hidden(ctx: RequestContext) {
        return { ok: ctx.resolve(HiddenTransient) instanceof HiddenTransient }
      }

      @Get('scoped')
      scoped(ctx: RequestContext) {
        ctx.resolve(Scoped)
        return { ok: true }
      }
    }

    @Module({ controllers: [Ctrl], providers: [Scoped] })
    class UsersModule {}

    it('app.get() and ctx.resolve() of a token of another module', async () => {
      const app = new Miia({ logger: false }).register(OtherModule, UsersModule)
      expect(app.get(Hidden)).toBeInstanceOf(Hidden)
      await app.init()
      expect(app.get(HiddenTransient)).toBeInstanceOf(HiddenTransient)
      expect(await (await request(app, '/hidden')).json()).toEqual({ ok: true })
      await app.destroy()
    })

    it('what a request provider built by ctx.resolve() injects is checked from its module', async () => {
      const app = new Miia({ logger: false }).register(OtherModule, UsersModule)
      await app.init()
      expect((await request(app, '/scoped')).status).toBe(500)
      expect((await request(app, '/hidden')).status).toBe(200)
      await app.destroy()
    })

    it('TestApp.resolve()', async () => {
      const core = await import('@miiajs/core')
      const { TestApp } = await import('@miiajs/testing')

      @core.Injectable()
      class Secret {}

      @core.Module({ providers: [Secret] })
      class SecretModule {}

      @core.Module({ imports: [SecretModule] })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      expect(app.resolve(Secret)).toBeInstanceOf(Secret)
      await app.close()
    })
  })

  describe('requesters without a module are checked from the root', () => {
    @Injectable()
    class Hidden {}

    @Module({ providers: [Hidden] })
    class UsersModule {}

    it('a provider registered with app.provide()', async () => {
      @Injectable()
      class Script {
        hidden = inject(Hidden)
      }

      const error = await initError(new Miia({ logger: false }).register(UsersModule).provide(Script))
      expect(error.message).toBe(
        report(
          'Script (registered with app.provide(), checked from the root) injects Hidden (UsersModule):\n' +
            '  - add Hidden to UsersModule `exports`',
        ),
      )
    })

    it('a global guard no module declares', async () => {
      class PeekGuard {
        hidden = inject(Hidden)
        canActivate() {
          return true
        }
      }

      const error = await initError(new Miia({ logger: false }).register(UsersModule).useGuard(PeekGuard))
      expect(error.message).toBe(
        report(
          'PeekGuard (global guard, checked from the root) injects Hidden (UsersModule):\n' +
            '  - add Hidden to UsersModule `exports`',
        ),
      )
    })

    it('a module that is not passed to register() is advised to be', async () => {
      @Injectable()
      class Script {
        hidden = inject(Hidden)
      }

      @Module({ imports: [UsersModule] })
      class AppModule {}

      const error = await initError(new Miia({ logger: false }).register(AppModule).provide(Script))
      expect(error.message).toBe(
        report(
          'Script (registered with app.provide(), checked from the root) injects Hidden (UsersModule):\n' +
            '  - add Hidden to UsersModule `exports`\n' +
            '  - pass UsersModule to app.register(), or make UsersModule global',
        ),
      )
    })
  })

  it('a route guard no module declares is not checked yet', async () => {
    @Injectable()
    class Hidden {}

    @Module({ providers: [Hidden] })
    class OtherModule {}

    class PeekGuard {
      hidden = inject(Hidden)
      canActivate() {
        return true
      }
    }

    @Controller('/')
    @UseGuard(PeekGuard)
    class Ctrl {
      @Get()
      get() {
        return { ok: true }
      }
    }

    @Module({ imports: [OtherModule], controllers: [Ctrl] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    expect((await request(app, '/')).status).toBe(200)
    await app.destroy()
  })

  describe('messages name the module', () => {
    it('of the requester in "No provider"', () => {
      const MISSING = createToken<object>('Missing')

      @Injectable()
      class OrdersService {
        missing = inject(MISSING)
      }

      @Module({ providers: [OrdersService] })
      class OrdersModule {}

      const app = new Miia({ logger: false }).register(OrdersModule)
      expect(thrownBy(() => app.get(OrdersService)).message).toBe(
        '[Miia] No provider found for token: Missing, required by OrdersService (OrdersModule)',
      )
    })

    it('of every step of a construction cycle', () => {
      @Injectable()
      class UsersService {
        orders = inject(OrdersService)
      }

      @Injectable()
      class OrdersService {
        users = inject(UsersService)
      }

      @Module({ imports: [forwardRef(() => OrdersModule)], providers: [UsersService], exports: [UsersService] })
      class UsersModule {}

      @Module({ imports: [forwardRef(() => UsersModule)], providers: [OrdersService], exports: [OrdersService] })
      class OrdersModule {}

      const app = new Miia({ logger: false }).register(UsersModule)
      expect(thrownBy(() => app.get(UsersService)).message.split('\n')[0]).toBe(
        '[Miia] Circular dependency detected: ' +
          'UsersService (UsersModule) -> OrdersService (OrdersModule) -> UsersService (UsersModule)',
      )
    })
  })
})
