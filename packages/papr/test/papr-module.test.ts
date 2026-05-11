import { describe, expect, it, mock, spyOn } from 'bun:test'
import { Container } from '@miiajs/core'
import type { FactoryProvider } from '@miiajs/core'
import { PaprModule } from '../src/papr.module.js'
import { PaprService } from '../src/papr.service.js'
import { defineModel } from '../src/define-model.js'
import { getInternalServiceToken, getRegistryToken, paprDb } from '../src/tokens.js'

function registerProviders(container: Container, providers: FactoryProvider[]) {
  for (const p of providers) {
    container.register(p.token, p.factory as any, p.scope)
  }
}

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

  it('returns a class-like (Constructor) so DI accepts it as a token', () => {
    expect(typeof paprDb()).toBe('function')
    expect(typeof paprDb('analytics')).toBe('function')
  })
})

describe('getInternalServiceToken', () => {
  it('returns __PAPR_SERVICE for default', () => {
    expect(getInternalServiceToken()).toBe('__PAPR_SERVICE')
  })

  it('returns __PAPR_SERVICE_name for named', () => {
    expect(getInternalServiceToken('analytics')).toBe('__PAPR_SERVICE_analytics')
  })
})

describe('getRegistryToken', () => {
  it('returns __PAPR_REGISTRY for default', () => {
    expect(getRegistryToken()).toBe('__PAPR_REGISTRY')
  })

  it('returns __PAPR_REGISTRY_name for named', () => {
    expect(getRegistryToken('analytics')).toBe('__PAPR_REGISTRY_analytics')
  })
})

describe('defineModel', () => {
  it('returns a class-token with collectionName, schema, and brand', () => {
    const User = defineModel('users', fakeSchema)
    expect(typeof User).toBe('function')
    expect(User.collectionName).toBe('users')
    expect(User.schema).toBe(fakeSchema)
    expect(User.__miiaPaprModel).toBe(true)
  })

  it('embeds collection name into class name for debug clarity', () => {
    const Post = defineModel('posts', fakeSchema)
    expect(Post.name).toBe('PaprModel(posts)')
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
    expect(result.providers).toHaveLength(3)
    const tokens = (result.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain('__PAPR_REGISTRY')
    expect(tokens).toContain('__PAPR_SERVICE')
    expect(tokens).toContain(paprDb())
  })

  it('builds a PaprService from the service-token factory', () => {
    const configured = PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } })
    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    const service = container.resolve('__PAPR_SERVICE')
    expect(service).toBeInstanceOf(PaprService)
  })

  it('builds a lazy Db proxy from the db-token factory', () => {
    const configured = PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } })
    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    // Resolve doesn't throw even though service is not yet onInit-ed (lazy proxy).
    const dbProxy = container.resolve(paprDb()) as any
    expect(typeof dbProxy).toBe('object')
  })
})

describe('PaprModule.configure (named)', () => {
  it('uses a unique module class for named connections', () => {
    const configured = PaprModule.configure({ connection: { url: 'mongodb://localhost/analytics' } }, 'analytics')
    expect(configured.module).not.toBe(PaprModule)
  })

  it('uses suffixed internal tokens and the named paprDb token', () => {
    const configured = PaprModule.configure({ connection: { url: 'mongodb://localhost/analytics' } }, 'analytics')
    const tokens = (configured.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain('__PAPR_REGISTRY_analytics')
    expect(tokens).toContain('__PAPR_SERVICE_analytics')
    expect(tokens).toContain(paprDb('analytics'))
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

    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    registerProviders(container, registered.providers as FactoryProvider[])

    const userModel = container.resolve(User)
    expect(typeof userModel).toBe('object')

    const registry = container.resolve('__PAPR_REGISTRY') as Map<unknown, unknown>
    expect(registry.has(User)).toBe(true)
  })

  it('throws a friendly error when configure() is missing', () => {
    const User = defineModel('users', fakeSchema)
    const registered = PaprModule.register([User])

    const container = new Container()
    registerProviders(container, registered.providers as FactoryProvider[])

    expect(() => container.resolve(User)).toThrow(/PaprModule.configure\(\) is missing/)
  })

  it('routes model lookup through PaprService.getModel via the proxy', () => {
    const User = defineModel('users', fakeSchema)
    const fakeModel = { find: () => 'fake-find' } as any
    const configured = PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } })
    const registered = PaprModule.register([User])

    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    registerProviders(container, registered.providers as FactoryProvider[])

    const service = container.resolve('__PAPR_SERVICE') as any
    const getModelSpy = spyOn(service, 'getModel').mockReturnValue(fakeModel)

    const proxy = container.resolve(User) as any
    expect(proxy.find()).toBe('fake-find')
    expect(getModelSpy).toHaveBeenCalledWith(User)
  })

  it('keeps registries separate per connection', () => {
    const User = defineModel('users', fakeSchema)
    const Event = defineModel('events', fakeSchema)

    const def = PaprModule.configure({ connection: { url: 'mongodb://localhost/test' } })
    const ana = PaprModule.configure({ connection: { url: 'mongodb://localhost/analytics' } }, 'analytics')
    const regDef = PaprModule.register([User])
    const regAna = PaprModule.register([Event], 'analytics')

    const container = new Container()
    registerProviders(container, def.providers as FactoryProvider[])
    registerProviders(container, ana.providers as FactoryProvider[])
    registerProviders(container, regDef.providers as FactoryProvider[])
    registerProviders(container, regAna.providers as FactoryProvider[])

    container.resolve(User)
    container.resolve(Event)

    const defReg = container.resolve('__PAPR_REGISTRY') as Map<unknown, unknown>
    const anaReg = container.resolve('__PAPR_REGISTRY_analytics') as Map<unknown, unknown>
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
      PaprModule.register([User], 'analytics')
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
