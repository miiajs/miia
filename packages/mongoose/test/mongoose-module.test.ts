import { describe, expect, it, spyOn } from 'bun:test'
import { Schema } from 'mongoose'
import { Injectable, Miia, Module, inject, overrideModule } from '@miiajs/core'
import type { FactoryProvider } from '@miiajs/core'
import { MongooseModule } from '../src/mongoose.module.js'
import { MongooseService } from '../src/mongoose.service.js'
import { defineModel } from '../src/define-model.js'
import { getInternalServiceToken, getRegistryToken, mongooseConnection } from '../src/tokens.js'

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

const uriOf = (service: MongooseService) => (service as any).options.uri

const userSchema = () => new Schema({ name: String })

describe('mongooseConnection', () => {
  it('returns the same token for the default connection', () => {
    expect(mongooseConnection()).toBe(mongooseConnection())
  })

  it('returns the same token for the same name', () => {
    expect(mongooseConnection('analytics')).toBe(mongooseConnection('analytics'))
  })

  it('returns different tokens for different names', () => {
    expect(mongooseConnection()).not.toBe(mongooseConnection('analytics'))
    expect(mongooseConnection('a')).not.toBe(mongooseConnection('b'))
  })

  it('treats an empty name as the default connection', () => {
    expect(mongooseConnection('')).toBe(mongooseConnection())
  })

  it('returns a frozen token object named after the connection', () => {
    expect(typeof mongooseConnection()).toBe('object')
    expect(Object.isFrozen(mongooseConnection('analytics'))).toBe(true)
    expect(mongooseConnection().name).toBe('mongooseConnection(default)')
    expect(mongooseConnection('analytics').name).toBe('mongooseConnection(analytics)')
  })

  it('hints at the configure() call that provides it', () => {
    expect(mongooseConnection().hint).toBe('MongooseModule.configure()')
    expect(mongooseConnection('analytics').hint).toBe("MongooseModule.configure(opts, { name: 'analytics' })")
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
  it('returns a frozen token object with modelName, schema, and brand', () => {
    const schema = userSchema()
    const User = defineModel('User', schema)
    expect(typeof User).toBe('object')
    expect(Object.isFrozen(User)).toBe(true)
    expect(User.modelName).toBe('User')
    expect(User.schema).toBe(schema)
    expect(User.__miiaMongooseModel).toBe(true)
  })

  it('embeds model name into the token name for debug clarity', () => {
    const Post = defineModel('Post', new Schema({ title: String }))
    expect(Post.name).toBe('MongooseModel(Post)')
  })

  it('hints at MongooseModule.register() with the model', () => {
    expect(defineModel('Post', new Schema({ title: String })).hint).toBe('MongooseModule.register([Post])')
  })

  it('returns a fresh token on each call (no memoization)', () => {
    const schema = userSchema()
    const a = defineModel('User', schema)
    const b = defineModel('User', schema)
    expect(a).not.toBe(b)
  })
})

describe('MongooseModule.configure (default)', () => {
  it('registers registry, service, and connection-token providers', () => {
    const result = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    expect(result.module).toBe(MongooseModule)
    expect(result.name).toBeUndefined()
    expect(result.providers).toHaveLength(3)
    const tokens = (result.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain(getRegistryToken())
    expect(tokens).toContain(getInternalServiceToken())
    expect(tokens).toContain(mongooseConnection())
  })

  it('exports mongooseConnection() and the internal tokens, and leaves global unset by default', () => {
    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    expect(configured.exports).toEqual([mongooseConnection(), getInternalServiceToken(), getRegistryToken()])
    expect(configured.global).toBeUndefined()
  })

  it('builds a MongooseService from the service-token factory', () => {
    const app = createApp(MongooseModule.configure({ uri: 'mongodb://localhost/test' }))
    expect(app.get(getInternalServiceToken())).toBeInstanceOf(MongooseService)
  })

  it('builds a lazy Connection proxy from the connection-token factory', () => {
    const app = createApp(MongooseModule.configure({ uri: 'mongodb://localhost/test' }))
    const connProxy = app.get(mongooseConnection())
    expect(typeof connProxy).toBe('object')
  })

  it('accepts factory function form', () => {
    const app = createApp(MongooseModule.configure(() => ({ uri: 'mongodb://localhost/test' })))
    expect(app.get(getInternalServiceToken())).toBeInstanceOf(MongooseService)
  })
})

describe('MongooseModule.configure (named)', () => {
  it('keeps MongooseModule as the module and carries the name', () => {
    const result = MongooseModule.configure({ uri: 'mongodb://localhost/analytics' }, { name: 'analytics' })
    expect(result.module).toBe(MongooseModule)
    expect(result.name).toBe('analytics')
  })

  it('exports the named tokens and passes { global: true } through', () => {
    const configured = MongooseModule.configure(
      { uri: 'mongodb://localhost/analytics' },
      { name: 'analytics', global: true },
    )
    expect(configured.exports).toEqual([
      mongooseConnection('analytics'),
      getInternalServiceToken('analytics'),
      getRegistryToken('analytics'),
    ])
    expect(configured.global).toBe(true)
  })

  it('uses the named internal tokens and the named mongooseConnection token', () => {
    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/analytics' }, { name: 'analytics' })
    const tokens = (configured.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain(getRegistryToken('analytics'))
    expect(tokens).toContain(getInternalServiceToken('analytics'))
    expect(tokens).toContain(mongooseConnection('analytics'))
  })

  it('throws when the same name is configured twice', () => {
    const a = MongooseModule.configure({ uri: 'mongodb://localhost/a' }, { name: 'analytics' })
    const b = MongooseModule.configure({ uri: 'mongodb://localhost/b' }, { name: 'analytics' })
    expect(() => createApp(a, b).get(mongooseConnection('analytics'))).toThrow(/configured twice/)
  })

  it('overrideModule() replaces the named connection and leaves the default one alone', () => {
    @Module({
      imports: [
        MongooseModule.configure({ uri: 'mongodb://localhost/main' }),
        MongooseModule.configure({ uri: 'mongodb://localhost/analytics' }, { name: 'analytics' }),
      ],
    })
    class Root {}

    const test = MongooseModule.configure({ uri: 'mongodb://localhost/test' }, { name: 'analytics' })
    const app = createApp(Root, overrideModule(test))

    expect(uriOf(app.get(getInternalServiceToken('analytics')))).toBe('mongodb://localhost/test')
    expect(uriOf(app.get(getInternalServiceToken()))).toBe('mongodb://localhost/main')
  })
})

describe('MongooseModule.register', () => {
  it('returns a feature module with one provider per model', () => {
    const User = defineModel('User', userSchema())
    const Post = defineModel('Post', new Schema({ title: String }))
    const result = MongooseModule.register([User, Post])
    expect(result.providers).toHaveLength(2)
    const tokens = (result.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain(User)
    expect(tokens).toContain(Post)
  })

  it('exports its models', () => {
    const User = defineModel('User', userSchema())
    const Post = defineModel('Post', new Schema({ title: String }))
    expect(MongooseModule.register([User, Post]).exports).toEqual([User, Post])
  })

  it('names the feature module after its models and connection', () => {
    const User = defineModel('User', userSchema())
    const Post = defineModel('Post', new Schema({ title: String }))
    const Event = defineModel('Event', new Schema({ type: String }))
    expect(MongooseModule.register([User, Post]).module.name).toBe('MongooseModule.register([User, Post])')
    expect(MongooseModule.register([Event], { name: 'analytics' }).module.name).toBe(
      "MongooseModule.register([Event], { name: 'analytics' })",
    )
  })

  it('lets two modules that register the same model share one instance', async () => {
    const onInit = spyOn(MongooseService.prototype, 'onInit').mockImplementation(async () => {})
    const onDestroy = spyOn(MongooseService.prototype, 'onDestroy').mockImplementation(async () => {})
    try {
      const User = defineModel('User', userSchema())

      @Injectable()
      class UsersService {
        users = inject(User)
      }

      @Injectable()
      class OrdersService {
        users = inject(User)
      }

      @Module({ imports: [MongooseModule, MongooseModule.register([User])], providers: [UsersService] })
      class UsersModule {}

      @Module({ imports: [MongooseModule, MongooseModule.register([User])], providers: [OrdersService] })
      class OrdersModule {}

      @Module({ imports: [MongooseModule.configure({ uri: 'mongodb://localhost/test' }), UsersModule, OrdersModule] })
      class Root {}

      const app = createApp(Root)
      await app.init()
      const users = app.get(UsersService).users
      expect(typeof users).toBe('function')
      expect(app.get(OrdersService).users).toBe(users)
      expect(app.get(User)).toBe(users)
      await app.destroy()
    } finally {
      onInit.mockRestore()
      onDestroy.mockRestore()
    }
  })

  it('checks a shared model from every module that registers it, whatever the order of imports', async () => {
    const onInit = spyOn(MongooseService.prototype, 'onInit').mockImplementation(async () => {})
    const onDestroy = spyOn(MongooseService.prototype, 'onDestroy').mockImplementation(async () => {})
    try {
      const User = defineModel('User', userSchema())

      // Only UsersModule imports MongooseModule: the register() module of ReportsModule cannot reach the connection.
      @Module({
        imports: [MongooseModule.configure({ uri: 'mongodb://localhost/test' }), MongooseModule.register([User])],
      })
      class UsersModule {}

      @Module({ imports: [MongooseModule.register([User])] })
      class ReportsModule {}

      @Module({ imports: [UsersModule, ReportsModule] })
      class RootAB {}

      @Module({ imports: [ReportsModule, UsersModule] })
      class RootBA {}

      const ab = await initError(createApp(RootAB))
      const ba = await initError(createApp(RootBA))
      expect(ab.message).toBe(
        '[Miia] 1 module boundary violation:\n\n' +
          'MongooseModel(User) (MongooseModule.register([User]) in ReportsModule) injects ' +
          'MongooseService(default), MongooseRegistry(default) (MongooseModule in UsersModule), which is not global:\n' +
          '  - make it global: MongooseModule.configure(options, { global: true })\n' +
          '  - or add MongooseModule to ReportsModule `imports`\n\n' +
          'Docs: /docs/core-concepts/modules#boundaries',
      )
      expect(ba.message).toBe(ab.message)
    } finally {
      onInit.mockRestore()
      onDestroy.mockRestore()
    }
  })

  it('populates the registry on resolve and returns a lazy Model proxy', () => {
    const User = defineModel('User', userSchema())
    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    const registered = MongooseModule.register([User])
    const app = createApp(configured, registered)

    const userModel = app.get(User)
    expect(typeof userModel).toBe('function') // proxy wraps a function for new/instanceof support

    const registry = app.get(getRegistryToken())
    expect(registry.has(User)).toBe(true)
  })

  it('throws a friendly error when configure() is missing', () => {
    const User = defineModel('User', userSchema())
    const app = createApp(MongooseModule.register([User]))

    expect(() => app.get(User)).toThrow(/MongooseModule.configure\(\) is missing/)
  })

  it('names the named configure() call when it is missing', () => {
    const Event = defineModel('Event', new Schema({ type: String }))
    const app = createApp(MongooseModule.register([Event], { name: 'analytics' }))

    expect(() => app.get(Event)).toThrow("MongooseModule.configure(opts, { name: 'analytics' }) is missing")
  })

  it('routes model lookup through MongooseService.getModel via the proxy', () => {
    const User = defineModel('User', userSchema())
    const fakeModel = { find: () => 'fake-find' } as any
    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    const registered = MongooseModule.register([User])
    const app = createApp(configured, registered)

    const service = app.get(getInternalServiceToken())
    const getModelSpy = spyOn(service, 'getModel').mockReturnValue(fakeModel)

    const proxy = app.get(User) as any
    expect(proxy.find()).toBe('fake-find')
    expect(getModelSpy).toHaveBeenCalledWith(User)
  })

  it('preserves prototype chain for instanceof checks', () => {
    const User = defineModel('User', userSchema())
    class FakeMongooseModel {}
    const fakeModel = Object.assign(new FakeMongooseModel(), {
      find: () => null,
    }) as any

    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    const registered = MongooseModule.register([User])
    const app = createApp(configured, registered)

    const service = app.get(getInternalServiceToken())
    spyOn(service, 'getModel').mockReturnValue(fakeModel)

    const proxy = app.get(User) as any
    // Force proxy resolution by reading any prop
    void proxy.find
    expect(Object.getPrototypeOf(proxy)).toBe(Object.getPrototypeOf(fakeModel))
  })

  it('forwards new User(data) construction to the underlying Model', () => {
    const User = defineModel('User', userSchema())
    const constructed: any[] = []
    function FakeMongooseModel(this: any, data: any) {
      Object.assign(this, data)
      constructed.push(data)
    }
    const fakeModel = FakeMongooseModel as any

    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    const registered = MongooseModule.register([User])
    const app = createApp(configured, registered)

    const service = app.get(getInternalServiceToken())
    spyOn(service, 'getModel').mockReturnValue(fakeModel)

    const proxy = app.get(User) as any
    const Ctor = proxy as new (data: any) => any
    const doc = new Ctor({ name: 'Alice' })
    expect(constructed).toEqual([{ name: 'Alice' }])
    expect(doc.name).toBe('Alice')
  })

  it('keeps registries separate per connection', () => {
    const User = defineModel('User', userSchema())
    const Event = defineModel('Event', new Schema({ type: String }))

    const def = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    const ana = MongooseModule.configure({ uri: 'mongodb://localhost/analytics' }, { name: 'analytics' })
    const regDef = MongooseModule.register([User])
    const regAna = MongooseModule.register([Event], { name: 'analytics' })
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
      const User = defineModel('User', userSchema())

      @Module({ imports: [MongooseModule.register([User])] })
      class UsersModule {}

      @Module({ imports: [MongooseModule.register([User], { name: 'analytics' })] })
      class ReportsModule {}

      const error = await initError(createApp(UsersModule, ReportsModule))
      expect(error.message).toBe(
        "[Miia] MongooseModel(User) is shared by MongooseModule.register([User]) in UsersModule (connection 'default') " +
          "and MongooseModule.register([User], { name: 'analytics' }) in ReportsModule (connection 'analytics') - " +
          'a shared provider must be declared the same way in every module; use a separate token for each variant',
      )
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('without global', () => {
  it('serves register() in a feature module that imports MongooseModule bare', async () => {
    const onInit = spyOn(MongooseService.prototype, 'onInit').mockImplementation(async () => {})
    const onDestroy = spyOn(MongooseService.prototype, 'onDestroy').mockImplementation(async () => {})
    try {
      const User = defineModel('User', userSchema())

      @Injectable()
      class UsersService {
        users = inject(User)
      }

      @Module({ imports: [MongooseModule, MongooseModule.register([User])], providers: [UsersService] })
      class UsersModule {}

      @Module({ imports: [MongooseModule.configure({ uri: 'mongodb://localhost/test' }), UsersModule] })
      class Root {}

      const app = createApp(Root)
      await app.init()
      expect(typeof app.get(UsersService).users).toBe('function')
      expect(app.get(getRegistryToken()).has(User)).toBe(true)
      await app.destroy()
    } finally {
      onInit.mockRestore()
      onDestroy.mockRestore()
    }
  })
})

describe('hook order', () => {
  it('runs the hooks of a provider injecting mongooseConnection() inside the connection window', async () => {
    const events: string[] = []
    const onInit = spyOn(MongooseService.prototype, 'onInit').mockImplementation(async () => {
      events.push('service.onInit')
    })
    const onDestroy = spyOn(MongooseService.prototype, 'onDestroy').mockImplementation(async () => {
      events.push('service.onDestroy')
    })
    try {
      @Injectable()
      class UsersService {
        connection = inject(mongooseConnection())

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
        imports: [UsersModule, MongooseModule.configure({ uri: 'mongodb://localhost/test' }, { global: true })],
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

describe('MongooseService', () => {
  it('throws when accessing connection before init', () => {
    const service = new MongooseService({ uri: 'mongodb://localhost/test' }, new Map())
    expect(() => service.connection).toThrow('Not connected')
  })

  it('throws a helpful error when getModel is called for an unknown token', () => {
    const Unknown = defineModel('Unknown', userSchema())
    const service = new MongooseService({ uri: 'mongodb://localhost/test' }, new Map())
    expect(() => service.getModel(Unknown)).toThrow(/not initialized/)
  })

  it('exposes onInit and onDestroy lifecycle methods', () => {
    const service = new MongooseService({ uri: 'mongodb://localhost/test' }, new Map())
    expect(typeof service.onInit).toBe('function')
    expect(typeof service.onDestroy).toBe('function')
  })

  it('detects two distinct tokens registered for the same model name', async () => {
    const A = defineModel('User', userSchema())
    const B = defineModel('User', userSchema()) // distinct token, same modelName
    const registry = new Map([
      [A, A],
      [B, B],
    ])
    const service = new MongooseService(
      { uri: 'mongodb://localhost/test', retry: { attempts: 1, delay: 1 } },
      registry as any,
    )
    await expect(service.onInit()).rejects.toThrow(/Two distinct ModelToken/)
  })
})
