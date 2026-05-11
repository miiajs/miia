import { describe, expect, it } from 'bun:test'
import { Container } from '@miiajs/core'
import type { FactoryProvider } from '@miiajs/core'
import { DrizzleModule } from '../src/drizzle.module.js'
import { DrizzleService } from '../src/drizzle.service.js'
import { drizzleDb, getInternalServiceToken } from '../src/tokens.js'

function registerProviders(container: Container, providers: FactoryProvider[]) {
  for (const p of providers) {
    container.register(p.token, p.factory as any, p.scope)
  }
}

describe('drizzleDb', () => {
  it('returns the same token for the default connection', () => {
    expect(drizzleDb()).toBe(drizzleDb())
  })

  it('returns the same token for the same name', () => {
    expect(drizzleDb('analytics')).toBe(drizzleDb('analytics'))
  })

  it('returns different tokens for different names', () => {
    expect(drizzleDb()).not.toBe(drizzleDb('analytics'))
    expect(drizzleDb('a')).not.toBe(drizzleDb('b'))
  })

  it('returns the same runtime token regardless of generic instantiation', () => {
    expect(drizzleDb<{ a: 1 }>()).toBe(drizzleDb<{ b: 2 }>())
  })

  it('returns a class-like (Constructor) so DI accepts it as a token', () => {
    expect(typeof drizzleDb()).toBe('function')
    expect(typeof drizzleDb('analytics')).toBe('function')
  })
})

describe('getInternalServiceToken', () => {
  it('returns __DRIZZLE_SERVICE for default', () => {
    expect(getInternalServiceToken()).toBe('__DRIZZLE_SERVICE')
  })

  it('returns __DRIZZLE_SERVICE_name for named', () => {
    expect(getInternalServiceToken('analytics')).toBe('__DRIZZLE_SERVICE_analytics')
  })
})

describe('DrizzleModule.configure (default)', () => {
  it('returns ConfiguredModule with module === DrizzleModule and 2 providers', () => {
    const configured = DrizzleModule.configure({
      dialect: 'postgres',
      connection: { url: 'postgres://localhost/test' },
    })
    expect(configured.module).toBe(DrizzleModule)
    expect(configured.providers).toHaveLength(2)
    const tokens = (configured.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain('__DRIZZLE_SERVICE')
    expect(tokens).toContain(drizzleDb())
  })

  it('builds a DrizzleService from the service-token factory', () => {
    const configured = DrizzleModule.configure({
      dialect: 'postgres',
      connection: { url: 'postgres://localhost/test' },
    })
    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    const service = container.resolve('__DRIZZLE_SERVICE')
    expect(service).toBeInstanceOf(DrizzleService)
  })

  it('accepts a factory function for options', () => {
    const configured = DrizzleModule.configure(() => ({
      dialect: 'postgres' as const,
      connection: { url: 'postgres://localhost/test' },
    }))
    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    const service = container.resolve('__DRIZZLE_SERVICE')
    expect(service).toBeInstanceOf(DrizzleService)
  })

  it('builds a lazy db proxy from the db-token factory', () => {
    const configured = DrizzleModule.configure({
      dialect: 'postgres',
      connection: { url: 'postgres://localhost/test' },
    })
    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])
    // Resolve does not throw even though service has not yet been onInit-ed - the proxy is lazy.
    const dbProxy = container.resolve(drizzleDb()) as any
    expect(typeof dbProxy).toBe('object')
  })
})

describe('DrizzleModule.configure (named)', () => {
  it('uses a unique module class for named connections', () => {
    const configured = DrizzleModule.configure(
      { dialect: 'postgres', connection: { url: 'postgres://localhost/analytics' } },
      'analytics',
    )
    expect(configured.module).not.toBe(DrizzleModule)
  })

  it('uses suffixed internal service token and the named drizzleDb token', () => {
    const configured = DrizzleModule.configure(
      { dialect: 'postgres', connection: { url: 'postgres://localhost/analytics' } },
      'analytics',
    )
    const tokens = (configured.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain('__DRIZZLE_SERVICE_analytics')
    expect(tokens).toContain(drizzleDb('analytics'))
  })

  it('isolates default and named db tokens', () => {
    const def = DrizzleModule.configure({ dialect: 'postgres', connection: { url: 'postgres://localhost/main' } })
    const ana = DrizzleModule.configure(
      { dialect: 'postgres', connection: { url: 'postgres://localhost/analytics' } },
      'analytics',
    )

    const container = new Container()
    registerProviders(container, def.providers as FactoryProvider[])
    registerProviders(container, ana.providers as FactoryProvider[])

    const defDb = container.resolve(drizzleDb())
    const anaDb = container.resolve(drizzleDb('analytics'))
    expect(defDb).not.toBe(anaDb)
  })
})

describe('lazy proxy forwarding', () => {
  it('routes property access through DrizzleService.db getter', () => {
    const fakeDb = { select: () => 'fake-select' } as any
    const configured = DrizzleModule.configure({
      dialect: 'postgres',
      connection: { url: 'postgres://localhost/test' },
    })

    const container = new Container()
    registerProviders(container, configured.providers as FactoryProvider[])

    const service = container.resolve('__DRIZZLE_SERVICE') as DrizzleService
    // Inject the fake db without going through onInit.
    ;(service as any)._db = fakeDb

    const proxy = container.resolve(drizzleDb()) as any
    expect(proxy.select()).toBe('fake-select')
  })
})

describe('DrizzleModule without configure', () => {
  it('throws when resolving drizzleDb() in a container without configure providers', () => {
    const container = new Container()
    expect(() => container.resolve(drizzleDb())).toThrow()
  })
})

describe('DrizzleService', () => {
  it('throws when accessing db before init', () => {
    const service = new DrizzleService({
      dialect: 'postgres',
      connection: { url: 'postgres://localhost/test' },
    })
    expect(() => service.db).toThrow('Not connected')
  })

  it('has onInit and onDestroy lifecycle methods', () => {
    const service = new DrizzleService({
      dialect: 'postgres',
      connection: { url: 'postgres://localhost/test' },
    })
    expect(typeof service.onInit).toBe('function')
    expect(typeof service.onDestroy).toBe('function')
  })
})
