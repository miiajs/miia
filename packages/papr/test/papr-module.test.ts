import { describe, expect, it, spyOn } from 'bun:test'
import { Injectable, Miia, Module, inject, overrideModule } from '@miiajs/core'
import type { FactoryProvider } from '@miiajs/core'
import { PaprModule } from '../src/papr.module.js'
import { PaprService } from '../src/papr.service.js'
import { defineModel } from '../src/define-model.js'
import { getInternalServiceToken, getRegistryToken, paprDb } from '../src/tokens.js'

function createApp(...modules: Parameters<Miia['register']>): Miia {
  return new Miia({ logger: false }).register(...modules)
}

async function initError(app: Miia): Promise<Error> {
  try {
    await app.init()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected init() to fail')
}

const urlOf = (service: PaprService) => (service as any).options.connection.url

const fakeSchema = [{} as any, {} as any] as [any, any]

describe('paprDb', () => {
  it('returns the same token for the default connection', () => {
    expect(paprDb()).toBe(paprDb())
  })

  it('returns the same token for the same name', () => {
    expect(paprDb('analytics')).toBe(paprDb('analytics'))
  })

  it('returns different tokens for different names', () => {
    expect(paprDb()).not.toBe(paprDb('analytics'))
    expect(paprDb('a')).not.toBe(paprDb('b'))
  })

  it('treats an empty name as the default connection', () => {
    expect(paprDb('')).toBe(paprDb())
  })

  it('returns a frozen token object named after the connection', () => {
    expect(typeof paprDb()).toBe('object')
    expect(Object.isFrozen(paprDb('analytics'))).toBe(true)
    expect(paprDb().name).toBe('paprDb(default)')
    expect(paprDb('analytics').name).toBe('paprDb(analytics)')
  })

  it('hints at the configure() call that provides it', () => {
    expect(paprDb().hint).toBe('PaprModule.configure()')
    expect(paprDb('analytics').hint).toBe("PaprModule.configure(opts, { name: 'analytics' })")
  })
})

describe('getInternalServiceToken', () => {
  it('returns the same token for the same name', () => {
    expect(getInternalServiceToken()).toBe(getInternalServiceToken())
    expect(getInternalServiceToken('analytics')).toBe(getInternalServiceToken('analytics'))
    expect(getInternalServiceToken('')).toBe(getInternalServiceToken())
  })

  it('returns different tokens for different names', () => {
    expect(getInternalServiceToken()).not.toBe(getInternalServiceToken('analytics'))
    expect(getInternalServiceToken('a')).not.toBe(getInternalServiceToken('b'))
  })
})

describe('getRegistryToken', () => {
  it('returns the same token for the same name', () => {
    expect(getRegistryToken()).toBe(getRegistryToken())
    expect(getRegistryToken('analytics')).toBe(getRegistryToken('analytics'))
    expect(getRegistryToken('')).toBe(getRegistryToken())
  })

  it('returns different tokens for different names', () => {
    expect(getRegistryToken()).not.toBe(getRegistryToken('analytics'))
    expect(getRegistryToken('a')).not.toBe(getRegistryToken('b'))
  })

  it('differs from the service token of the same connection', () => {
    expect(getRegistryToken()).not.toBe(getInternalServiceToken() as unknown)
  })
})

describe('defineModel', () => {
  it('returns a frozen token object with collectionName, schema, and brand', () => {
    const User = defineModel('users', fakeSchema)
    expect(typeof User).toBe('object')
    expect(Object.isFrozen(User)).toBe(true)
    expect(User.collectionName).toBe('users')
    expect(User.schema).toBe(fakeSchema)
    expect(User.__miiaPaprModel).toBe(true)
  })

  it('embeds collection name into the token name for debug clarity', () => {
    const Post = defineModel('posts', fakeSchema)
    expect(Post.name).toBe('PaprModel(posts)')
  })

  it('hints at PaprModule.register() with the model', () => {
    expect(defineModel('posts', fakeSchema).hint).toBe('PaprModule.register([posts])')
  })

  it('names the register() call in the error for a model nobody registered', () => {
    const User = defineModel('users', fakeSchema)

    @Injectable()
    class UsersService {
      users = inject(User)
    }

    const app = createApp(PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } }))
    app.provide(UsersService)

    expect(() => app.get(UsersService)).toThrow(
      'PaprModel(users) is provided by PaprModule.register([users]); import that module where PaprModel(users) is used',
    )
  })

  it('returns a fresh token on each call (no memoization)', () => {
    const a = defineModel('users', fakeSchema)
    const b = defineModel('users', fakeSchema)
    expect(a).not.toBe(b)
  })
})

describe('PaprModule.configure (default)', () => {
  it('registers registry, service, and db-token providers', () => {
    const result = PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } })
    expect(result.module).toBe(PaprModule)
    expect(result.name).toBeUndefined()
    expect(result.providers).toHaveLength(3)
    const tokens = (result.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain(getRegistryToken())
    expect(tokens).toContain(getInternalServiceToken())
    expect(tokens).toContain(paprDb())
  })

  it('exports paprDb() and the internal tokens, and leaves global unset by default', () => {
    const configured = PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } })
    expect(configured.exports).toEqual([paprDb(), getInternalServiceToken(), getRegistryToken()])
    expect(configured.global).toBeUndefined()
  })

  it('builds a PaprService from the service-token factory', () => {
    const app = createApp(PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } }))
    expect(app.get(getInternalServiceToken())).toBeInstanceOf(PaprService)
  })

  it('builds a lazy Db proxy from the db-token factory', () => {
    const app = createApp(PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } }))
    // Resolve doesn't throw even though service is not yet onInit-ed (lazy proxy).
    const dbProxy = app.get(paprDb())
    expect(typeof dbProxy).toBe('object')
  })
})

describe('PaprModule.configure (named)', () => {
  it('keeps PaprModule as the module and carries the name', () => {
    const configured = PaprModule.configure(
      { connection: { url: 'mongodb://localhost/analytics' } },
      { name: 'analytics' },
    )
    expect(configured.module).toBe(PaprModule)
    expect(configured.name).toBe('analytics')
  })

  it('exports the named tokens and passes { global: true } through', () => {
    const configured = PaprModule.configure(
      { connection: { url: 'mongodb://localhost/analytics' } },
      { name: 'analytics', global: true },
    )
    expect(configured.exports).toEqual([
      paprDb('analytics'),
      getInternalServiceToken('analytics'),
      getRegistryToken('analytics'),
    ])
    expect(configured.global).toBe(true)
  })

  it('uses the named internal tokens and the named paprDb token', () => {
    const configured = PaprModule.configure(
      { connection: { url: 'mongodb://localhost/analytics' } },
      { name: 'analytics' },
    )
    const tokens = (configured.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain(getRegistryToken('analytics'))
    expect(tokens).toContain(getInternalServiceToken('analytics'))
    expect(tokens).toContain(paprDb('analytics'))
  })

  it('throws when the same name is configured twice', () => {
    const a = PaprModule.configure({ connection: { url: 'mongodb://localhost/a' } }, { name: 'analytics' })
    const b = PaprModule.configure({ connection: { url: 'mongodb://localhost/b' } }, { name: 'analytics' })
    expect(() => createApp(a, b).get(paprDb('analytics'))).toThrow(/configured twice/)
  })

  it('overrideModule() replaces the named connection and leaves the default one alone', () => {
    @Module({
      imports: [
        PaprModule.configure({ connection: { url: 'mongodb://localhost/main' } }),
        PaprModule.configure({ connection: { url: 'mongodb://localhost/analytics' } }, { name: 'analytics' }),
      ],
    })
    class Root {}

    const test = PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } }, { name: 'analytics' })
    const app = createApp(Root, overrideModule(test))

    expect(urlOf(app.get(getInternalServiceToken('analytics')))).toBe('mongodb://localhost/test')
    expect(urlOf(app.get(getInternalServiceToken()))).toBe('mongodb://localhost/main')
  })
})

describe('PaprModule.register', () => {
  it('returns a feature module with one provider per model', () => {
    const User = defineModel('users', fakeSchema)
    const Post = defineModel('posts', fakeSchema)
    const result = PaprModule.register([User, Post])
    expect(result.providers).toHaveLength(2)
    const tokens = (result.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain(User)
    expect(tokens).toContain(Post)
  })

  it('exports its models', () => {
    const User = defineModel('users', fakeSchema)
    const Post = defineModel('posts', fakeSchema)
    expect(PaprModule.register([User, Post]).exports).toEqual([User, Post])
  })

  it('names the feature module after its collections and connection', () => {
    const User = defineModel('users', fakeSchema)
    const Post = defineModel('posts', fakeSchema)
    const Event = defineModel('events', fakeSchema)
    expect(PaprModule.register([User, Post]).module.name).toBe('PaprModule.register([users, posts])')
    expect(PaprModule.register([Event], { name: 'analytics' }).module.name).toBe(
      "PaprModule.register([events], { name: 'analytics' })",
    )
  })

  it('lets two modules that register the same model share one instance', async () => {
    const onInit = spyOn(PaprService.prototype, 'onInit').mockImplementation(async () => {})
    const onDestroy = spyOn(PaprService.prototype, 'onDestroy').mockImplementation(async () => {})
    try {
      const User = defineModel('users', fakeSchema)

      @Injectable()
      class UsersService {
        users = inject(User)
      }

      @Injectable()
      class OrdersService {
        users = inject(User)
      }

      @Module({ imports: [PaprModule, PaprModule.register([User])], providers: [UsersService] })
      class UsersModule {}

      @Module({ imports: [PaprModule, PaprModule.register([User])], providers: [OrdersService] })
      class OrdersModule {}

      @Module({
        imports: [PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } }), UsersModule, OrdersModule],
      })
      class Root {}

      const app = createApp(Root)
      await app.init()
      const users = app.get(UsersService).users
      expect(typeof users).toBe('object')
      expect(app.get(OrdersService).users).toBe(users)
      expect(app.get(User)).toBe(users)
      await app.destroy()
    } finally {
      onInit.mockRestore()
      onDestroy.mockRestore()
    }
  })

  it('checks a shared model from every module that registers it, whatever the order of imports', async () => {
    const onInit = spyOn(PaprService.prototype, 'onInit').mockImplementation(async () => {})
    const onDestroy = spyOn(PaprService.prototype, 'onDestroy').mockImplementation(async () => {})
    try {
      const User = defineModel('users', fakeSchema)

      // Only UsersModule imports PaprModule: the register() module of ReportsModule cannot reach the connection.
      @Module({
        imports: [
          PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } }),
          PaprModule.register([User]),
        ],
      })
      class UsersModule {}

      @Module({ imports: [PaprModule.register([User])] })
      class ReportsModule {}

      @Module({ imports: [UsersModule, ReportsModule] })
      class RootAB {}

      @Module({ imports: [ReportsModule, UsersModule] })
      class RootBA {}

      const ab = await initError(createApp(RootAB))
      const ba = await initError(createApp(RootBA))
      expect(ab.message).toBe(
        '[Miia] 1 module boundary violation:\n\n' +
          'PaprModel(users) (PaprModule.register([users]) in ReportsModule) injects ' +
          'PaprService(default), PaprRegistry(default) (PaprModule in UsersModule), which is not global:\n' +
          '  - make it global: PaprModule.configure(options, { global: true })\n' +
          '  - or add PaprModule to ReportsModule `imports`\n\n' +
          'Docs: /docs/core-concepts/modules#boundaries',
      )
      expect(ba.message).toBe(ab.message)
    } finally {
      onInit.mockRestore()
      onDestroy.mockRestore()
    }
  })

  it('populates the registry on resolve and returns a lazy Model proxy', () => {
    const User = defineModel('users', fakeSchema)
    const configured = PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } })
    const registered = PaprModule.register([User])
    const app = createApp(configured, registered)

    const userModel = app.get(User)
    expect(typeof userModel).toBe('object')

    const registry = app.get(getRegistryToken())
    expect(registry.has(User)).toBe(true)
  })

  it('throws a friendly error when configure() is missing', () => {
    const User = defineModel('users', fakeSchema)
    const app = createApp(PaprModule.register([User]))

    expect(() => app.get(User)).toThrow(/PaprModule.configure\(\) is missing/)
  })

  it('names the named configure() call when it is missing', () => {
    const Event = defineModel('events', fakeSchema)
    const app = createApp(PaprModule.register([Event], { name: 'analytics' }))

    expect(() => app.get(Event)).toThrow("PaprModule.configure(opts, { name: 'analytics' }) is missing")
  })

  it('routes model lookup through PaprService.getModel via the proxy', () => {
    const User = defineModel('users', fakeSchema)
    const fakeModel = { find: () => 'fake-find' } as any
    const configured = PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } })
    const registered = PaprModule.register([User])
    const app = createApp(configured, registered)

    const service = app.get(getInternalServiceToken())
    const getModelSpy = spyOn(service, 'getModel').mockReturnValue(fakeModel)

    const proxy = app.get(User) as any
    expect(proxy.find()).toBe('fake-find')
    expect(getModelSpy).toHaveBeenCalledWith(User)
  })

  it('keeps registries separate per connection', () => {
    const User = defineModel('users', fakeSchema)
    const Event = defineModel('events', fakeSchema)

    const def = PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } })
    const ana = PaprModule.configure({ connection: { url: 'mongodb://localhost/analytics' } }, { name: 'analytics' })
    const regDef = PaprModule.register([User])
    const regAna = PaprModule.register([Event], { name: 'analytics' })
    const app = createApp(def, ana, regDef, regAna)

    app.get(User)
    app.get(Event)

    const defReg = app.get(getRegistryToken())
    const anaReg = app.get(getRegistryToken('analytics'))
    expect(defReg.has(User)).toBe(true)
    expect(defReg.has(Event)).toBe(false)
    expect(anaReg.has(Event)).toBe(true)
    expect(anaReg.has(User)).toBe(false)
  })

  it('rejects the same token registered for two different connections at startup, without a warning', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const User = defineModel('users', fakeSchema)

      @Module({ imports: [PaprModule.register([User])] })
      class UsersModule {}

      @Module({ imports: [PaprModule.register([User], { name: 'analytics' })] })
      class ReportsModule {}

      const error = await initError(createApp(UsersModule, ReportsModule))
      expect(error.message).toBe(
        '[Miia] PaprModel(users) is shared by PaprModule.register([users]) in UsersModule (the default connection) ' +
          "and PaprModule.register([users], { name: 'analytics' }) in ReportsModule (connection 'analytics') - " +
          'a shared provider must be declared the same way in every module; use a separate token for each variant',
      )
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('does not share a model between the unnamed connection and one named default', async () => {
    const User = defineModel('users', fakeSchema)

    @Module({ imports: [PaprModule.register([User])] })
    class UsersModule {}

    @Module({ imports: [PaprModule.register([User], { name: 'default' })] })
    class ReportsModule {}

    const error = await initError(createApp(UsersModule, ReportsModule))
    expect(error.message).toBe(
      '[Miia] PaprModel(users) is shared by PaprModule.register([users]) in UsersModule (the default connection) ' +
        "and PaprModule.register([users], { name: 'default' }) in ReportsModule (connection 'default') - " +
        'a shared provider must be declared the same way in every module; use a separate token for each variant',
    )
  })
})

describe('without global', () => {
  it('serves register() in a feature module that imports PaprModule bare', async () => {
    const onInit = spyOn(PaprService.prototype, 'onInit').mockImplementation(async () => {})
    const onDestroy = spyOn(PaprService.prototype, 'onDestroy').mockImplementation(async () => {})
    try {
      const User = defineModel('users', fakeSchema)

      @Injectable()
      class UsersService {
        users = inject(User)
      }

      @Module({ imports: [PaprModule, PaprModule.register([User])], providers: [UsersService] })
      class UsersModule {}

      @Module({ imports: [PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } }), UsersModule] })
      class Root {}

      const app = createApp(Root)
      await app.init()
      expect(typeof app.get(UsersService).users).toBe('object')
      expect(app.get(getRegistryToken()).has(User)).toBe(true)
      await app.destroy()
    } finally {
      onInit.mockRestore()
      onDestroy.mockRestore()
    }
  })
})

describe('hook order', () => {
  it('runs the hooks of a provider injecting paprDb() inside the connection window', async () => {
    const events: string[] = []
    const onInit = spyOn(PaprService.prototype, 'onInit').mockImplementation(async () => {
      events.push('service.onInit')
    })
    const onDestroy = spyOn(PaprService.prototype, 'onDestroy').mockImplementation(async () => {
      events.push('service.onDestroy')
    })
    try {
      @Injectable()
      class UsersService {
        db = inject(paprDb())

        async onInit() {
          events.push('user.onInit')
        }

        async onDestroy() {
          events.push('user.onDestroy')
        }
      }

      @Module({ providers: [UsersService] })
      class UsersModule {}

      // Imported before configure(), so without deps the consumer's hooks would come first
      @Module({
        imports: [
          UsersModule,
          PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } }, { global: true }),
        ],
      })
      class Root {}

      const app = createApp(Root)
      await app.init()
      await app.destroy()
      expect(events).toEqual(['service.onInit', 'user.onInit', 'user.onDestroy', 'service.onDestroy'])
    } finally {
      onInit.mockRestore()
      onDestroy.mockRestore()
    }
  })
})

describe('PaprService', () => {
  it('throws when accessing db before init', () => {
    const service = new PaprService({ connection: { url: 'mongodb://localhost/test' } }, new Map())
    expect(() => service.db).toThrow('Not connected')
  })

  it('throws a helpful error when getModel is called for an unknown token', () => {
    const Unknown = defineModel('unknown', fakeSchema)
    const service = new PaprService({ connection: { url: 'mongodb://localhost/test' } }, new Map())
    expect(() => service.getModel(Unknown)).toThrow(
      '[Miia/Papr] Model "unknown" not initialized. Did you forget to register it with PaprModule.register([unknown])?',
    )
  })

  it('exposes onInit and onDestroy lifecycle methods', () => {
    const service = new PaprService({ connection: { url: 'mongodb://localhost/test' } }, new Map())
    expect(typeof service.onInit).toBe('function')
    expect(typeof service.onDestroy).toBe('function')
  })

  it('detects two distinct tokens registered for the same collection', async () => {
    const A = defineModel('users', fakeSchema)
    const B = defineModel('users', fakeSchema) // distinct token, same collection
    const registry = new Map([
      [A, A],
      [B, B],
    ])
    const service = new PaprService(
      { connection: { url: 'mongodb://localhost/test', retry: { attempts: 1, delay: 1 } } },
      registry as any,
    )

    await expect(service.onInit()).rejects.toThrow(/Two distinct ModelToken/)
  })
})
