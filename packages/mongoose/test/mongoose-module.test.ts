import { describe, expect, it, spyOn } from 'bun:test'
import { Schema } from 'mongoose'
import { Container } from '@miiajs/core'
import type { FactoryProvider } from '@miiajs/core'
import { MongooseModule } from '../src/mongoose.module.js'
import { MongooseService } from '../src/mongoose.service.js'
import { defineModel } from '../src/define-model.js'
import { getInternalServiceToken, getRegistryToken, mongooseConnection } from '../src/tokens.js'

function registerProviders(container: Container, providers: FactoryProvider[]) {
  for (const p of providers) {
    container.register(p.token, p.factory as any, p.scope)
  }
}

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

  it('returns a class-like (Constructor) so DI accepts it as a token', () => {
    expect(typeof mongooseConnection()).toBe('function')
  })
})

describe('getInternalServiceToken', () => {
  it('returns __MONGOOSE_SERVICE for default', () => {
    expect(getInternalServiceToken()).toBe('__MONGOOSE_SERVICE')
  })

  it('returns __MONGOOSE_SERVICE_name for named', () => {
    expect(getInternalServiceToken('analytics')).toBe('__MONGOOSE_SERVICE_analytics')
  })
})

describe('getRegistryToken', () => {
  it('returns __MONGOOSE_REGISTRY for default', () => {
    expect(getRegistryToken()).toBe('__MONGOOSE_REGISTRY')
  })

  it('returns __MONGOOSE_REGISTRY_name for named', () => {
    expect(getRegistryToken('analytics')).toBe('__MONGOOSE_REGISTRY_analytics')
  })
})

describe('defineModel', () => {
  it('returns a class-token with modelName, schema, and brand', () => {
    const schema = userSchema()
    const User = defineModel('User', schema)
    expect(typeof User).toBe('function')
    expect(User.modelName).toBe('User')
    expect(User.schema).toBe(schema)
    expect(User.__miiaMongooseModel).toBe(true)
  })

  it('embeds model name into class name for debug clarity', () => {
    const Post = defineModel('Post', new Schema({ title: String }))
    expect(Post.name).toBe('MongooseModel(Post)')
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
    expect(result.providers).toHaveLength(3)
    const tokens = (result.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain('__MONGOOSE_REGISTRY')
    expect(tokens).toContain('__MONGOOSE_SERVICE')
    expect(tokens).toContain(mongooseConnection())
  })

  it('builds a MongooseService from the service-token factory', () => {
    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    const service = container.resolve('__MONGOOSE_SERVICE')
    expect(service).toBeInstanceOf(MongooseService)
  })

  it('builds a lazy Connection proxy from the connection-token factory', () => {
    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    const connProxy = container.resolve(mongooseConnection())
    expect(typeof connProxy).toBe('object')
  })

  it('accepts factory function form', () => {
    const result = MongooseModule.configure(() => ({ uri: 'mongodb://localhost/test' }))
    const container = new Container()
    registerProviders(container, result.providers as FactoryProvider[])
    expect(container.resolve('__MONGOOSE_SERVICE')).toBeInstanceOf(MongooseService)
  })
})

describe('MongooseModule.configure (named)', () => {
  it('uses a unique module class for named connections', () => {
    const result = MongooseModule.configure({ uri: 'mongodb://localhost/analytics' }, 'analytics')
    expect(result.module).not.toBe(MongooseModule)
  })

  it('uses suffixed internal tokens and the named mongooseConnection token', () => {
    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/analytics' }, 'analytics')
    const tokens = (configured.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain('__MONGOOSE_REGISTRY_analytics')
    expect(tokens).toContain('__MONGOOSE_SERVICE_analytics')
    expect(tokens).toContain(mongooseConnection('analytics'))
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

  it('populates the registry on resolve and returns a lazy Model proxy', () => {
    const User = defineModel('User', userSchema())
    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    const registered = MongooseModule.register([User])

    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    registerProviders(container, registered.providers as FactoryProvider[])

    const userModel = container.resolve(User)
    expect(typeof userModel).toBe('function') // proxy wraps a function for new/instanceof support

    const registry = container.resolve('__MONGOOSE_REGISTRY') as Map<unknown, unknown>
    expect(registry.has(User)).toBe(true)
  })

  it('throws a friendly error when configure() is missing', () => {
    const User = defineModel('User', userSchema())
    const registered = MongooseModule.register([User])

    const container = new Container()
    registerProviders(container, registered.providers as FactoryProvider[])

    expect(() => container.resolve(User)).toThrow(/MongooseModule.configure\(\) is missing/)
  })

  it('routes model lookup through MongooseService.getModel via the proxy', () => {
    const User = defineModel('User', userSchema())
    const fakeModel = { find: () => 'fake-find' } as any
    const configured = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    const registered = MongooseModule.register([User])

    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    registerProviders(container, registered.providers as FactoryProvider[])

    const service = container.resolve('__MONGOOSE_SERVICE') as any
    const getModelSpy = spyOn(service, 'getModel').mockReturnValue(fakeModel)

    const proxy = container.resolve(User) as any
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
    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    registerProviders(container, registered.providers as FactoryProvider[])

    const service = container.resolve('__MONGOOSE_SERVICE') as any
    spyOn(service, 'getModel').mockReturnValue(fakeModel)

    const proxy = container.resolve(User) as any
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
    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    registerProviders(container, registered.providers as FactoryProvider[])

    const service = container.resolve('__MONGOOSE_SERVICE') as any
    spyOn(service, 'getModel').mockReturnValue(fakeModel)

    const proxy = container.resolve(User) as any
    const Ctor = proxy as new (data: any) => any
    const doc = new Ctor({ name: 'Alice' })
    expect(constructed).toEqual([{ name: 'Alice' }])
    expect(doc.name).toBe('Alice')
  })

  it('keeps registries separate per connection', () => {
    const User = defineModel('User', userSchema())
    const Event = defineModel('Event', new Schema({ type: String }))

    const def = MongooseModule.configure({ uri: 'mongodb://localhost/test' })
    const ana = MongooseModule.configure({ uri: 'mongodb://localhost/analytics' }, 'analytics')
    const regDef = MongooseModule.register([User])
    const regAna = MongooseModule.register([Event], 'analytics')

    const container = new Container()
    registerProviders(container, def.providers as FactoryProvider[])
    registerProviders(container, ana.providers as FactoryProvider[])
    registerProviders(container, regDef.providers as FactoryProvider[])
    registerProviders(container, regAna.providers as FactoryProvider[])

    container.resolve(User)
    container.resolve(Event)

    const defReg = container.resolve('__MONGOOSE_REGISTRY') as Map<unknown, unknown>
    const anaReg = container.resolve('__MONGOOSE_REGISTRY_analytics') as Map<unknown, unknown>
    expect(defReg.has(User)).toBe(true)
    expect(defReg.has(Event)).toBe(false)
    expect(anaReg.has(Event)).toBe(true)
    expect(anaReg.has(User)).toBe(false)
  })

  it('warns when the same token is registered for two different connections', () => {
    const User = defineModel('User', userSchema())
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      MongooseModule.register([User])
      MongooseModule.register([User], 'analytics')
      expect(warnSpy).toHaveBeenCalled()
      const args = warnSpy.mock.calls[warnSpy.mock.calls.length - 1] as string[]
      expect(args[0]).toContain('registered in connections')
    } finally {
      warnSpy.mockRestore()
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
