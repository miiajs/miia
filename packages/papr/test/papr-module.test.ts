import { describe, expect, it, spyOn } from 'bun:test'
import { Miia, Module, overrideModule } from '@miiajs/core'
import type { FactoryProvider } from '@miiajs/core'
import { PaprModule } from '../src/papr.module.js'
import { PaprService } from '../src/papr.service.js'
import { defineModel } from '../src/define-model.js'
import { getInternalServiceToken, getRegistryToken, paprDb } from '../src/tokens.js'

function createApp(...modules: Parameters<Miia['register']>): Miia {
  return new Miia({ logger: false }).register(...modules)
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

  it('hints at PaprModule.register()', () => {
    expect(defineModel('posts', fakeSchema).hint).toBe('PaprModule.register([...])')
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

  it('warns when the same token is registered for two different connections', () => {
    const User = defineModel('users', fakeSchema)
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      PaprModule.register([User])
      PaprModule.register([User], { name: 'analytics' })
      expect(warnSpy).toHaveBeenCalled()
      const args = warnSpy.mock.calls[warnSpy.mock.calls.length - 1] as string[]
      expect(args[0]).toContain('registered in connections')
    } finally {
      warnSpy.mockRestore()
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
    expect(() => service.getModel(Unknown)).toThrow(/not initialized/)
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
