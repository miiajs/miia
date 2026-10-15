import { describe, expect, it, spyOn } from 'bun:test'
import { Injectable, Miia, Module, inject, overrideModule } from '@miiajs/core'
import type { FactoryProvider } from '@miiajs/core'
import { DrizzleModule } from '../src/drizzle.module.js'
import { DrizzleService } from '../src/drizzle.service.js'
import { drizzleDb, getInternalServiceToken } from '../src/tokens.js'
import type { DrizzleModuleOptions } from '../src/types.js'

function createApp(...modules: Parameters<Miia['register']>): Miia {
  return new Miia({ logger: false }).register(...modules)
}

const pg = (url: string): DrizzleModuleOptions => ({ dialect: 'postgres', connection: { url } })
const urlOf = (service: DrizzleService) => (service as any).options.connection.url

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

  it('treats an empty name as the default connection', () => {
    expect(drizzleDb('')).toBe(drizzleDb())
  })

  it('returns the same runtime token regardless of generic instantiation', () => {
    expect(drizzleDb<{ a: 1 }>() as unknown).toBe(drizzleDb<{ b: 2 }>())
  })

  it('returns a frozen token object named after the connection', () => {
    expect(typeof drizzleDb()).toBe('object')
    expect(Object.isFrozen(drizzleDb('analytics'))).toBe(true)
    expect(drizzleDb().name).toBe('drizzleDb(default)')
    expect(drizzleDb('analytics').name).toBe('drizzleDb(analytics)')
  })

  it('hints at the configure() call that provides it', () => {
    expect(drizzleDb().hint).toBe('DrizzleModule.configure()')
    expect(drizzleDb('analytics').hint).toBe("DrizzleModule.configure(opts, { name: 'analytics' })")
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

  it('is a token of its own, not the db token', () => {
    expect(getInternalServiceToken()).not.toBe(drizzleDb() as unknown)
    expect(getInternalServiceToken().name).toBe('DrizzleService(default)')
  })
})

describe('DrizzleModule.configure (default)', () => {
  it('returns ConfiguredModule with module === DrizzleModule and 2 providers', () => {
    const configured = DrizzleModule.configure(pg('postgres://localhost/test'))
    expect(configured.module).toBe(DrizzleModule)
    expect(configured.name).toBeUndefined()
    expect(configured.providers).toHaveLength(2)
    const tokens = (configured.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain(getInternalServiceToken())
    expect(tokens).toContain(drizzleDb())
  })

  it('builds a DrizzleService from the service-token factory', () => {
    const app = createApp(DrizzleModule.configure(pg('postgres://localhost/test')))
    expect(app.get(getInternalServiceToken())).toBeInstanceOf(DrizzleService)
  })

  it('accepts a factory function for options', () => {
    const configured = DrizzleModule.configure(() => pg('postgres://localhost/test'))
    const service = createApp(configured).get(getInternalServiceToken())
    expect(service).toBeInstanceOf(DrizzleService)
    expect(urlOf(service)).toBe('postgres://localhost/test')
  })

  it('builds a lazy db proxy from the db-token factory', () => {
    const app = createApp(DrizzleModule.configure(pg('postgres://localhost/test')))
    // Resolve does not throw even though service has not yet been onInit-ed - the proxy is lazy.
    const dbProxy = app.get(drizzleDb())
    expect(typeof dbProxy).toBe('object')
  })
})

describe('DrizzleModule.configure (named)', () => {
  it('keeps DrizzleModule as the module and carries the name', () => {
    const configured = DrizzleModule.configure(pg('postgres://localhost/analytics'), { name: 'analytics' })
    expect(configured.module).toBe(DrizzleModule)
    expect(configured.name).toBe('analytics')
  })

  it('treats an empty name as the default connection', () => {
    const configured = DrizzleModule.configure(pg('postgres://localhost/test'), { name: '' })
    expect(configured.name).toBeUndefined()
    const tokens = (configured.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain(getInternalServiceToken())
    expect(tokens).toContain(drizzleDb())
  })

  it('uses the named internal service token and the named drizzleDb token', () => {
    const configured = DrizzleModule.configure(pg('postgres://localhost/analytics'), { name: 'analytics' })
    const tokens = (configured.providers as FactoryProvider[]).map((p) => p.token)
    expect(tokens).toContain(getInternalServiceToken('analytics'))
    expect(tokens).toContain(drizzleDb('analytics'))
  })

  it('isolates default and named connections', () => {
    const def = DrizzleModule.configure(pg('postgres://localhost/main'))
    const ana = DrizzleModule.configure(pg('postgres://localhost/analytics'), { name: 'analytics' })
    const app = createApp(def, ana)

    expect(app.get(drizzleDb())).not.toBe(app.get(drizzleDb('analytics')))
    expect(urlOf(app.get(getInternalServiceToken()))).toBe('postgres://localhost/main')
    expect(urlOf(app.get(getInternalServiceToken('analytics')))).toBe('postgres://localhost/analytics')
  })

  it('throws when the same name is configured twice', () => {
    const a = DrizzleModule.configure(pg('postgres://localhost/a'), { name: 'analytics' })
    const b = DrizzleModule.configure(pg('postgres://localhost/b'), { name: 'analytics' })
    expect(() => createApp(a, b).get(drizzleDb('analytics'))).toThrow(/configured twice/)
  })

  it('overrideModule() replaces the named connection and leaves the default one alone', () => {
    @Module({
      imports: [
        DrizzleModule.configure(pg('postgres://localhost/main')),
        DrizzleModule.configure(pg('postgres://localhost/analytics'), { name: 'analytics' }),
      ],
    })
    class Root {}

    const test = DrizzleModule.configure(pg('postgres://localhost/test'), { name: 'analytics' })
    const app = createApp(Root, overrideModule(test))

    expect(urlOf(app.get(getInternalServiceToken('analytics')))).toBe('postgres://localhost/test')
    expect(urlOf(app.get(getInternalServiceToken()))).toBe('postgres://localhost/main')
  })
})

describe('lazy proxy forwarding', () => {
  it('routes property access through DrizzleService.db getter', () => {
    const fakeDb = { select: () => 'fake-select' } as any
    const app = createApp(DrizzleModule.configure(pg('postgres://localhost/test')))

    const service = app.get(getInternalServiceToken())
    // Inject the fake db without going through onInit.
    ;(service as any)._db = fakeDb

    const proxy = app.get(drizzleDb()) as any
    expect(proxy.select()).toBe('fake-select')
  })
})

describe('hook order', () => {
  async function hookEvents(name?: string): Promise<string[]> {
    const events: string[] = []
    const onInit = spyOn(DrizzleService.prototype, 'onInit').mockImplementation(async () => {
      events.push('service.onInit')
    })
    const onDestroy = spyOn(DrizzleService.prototype, 'onDestroy').mockImplementation(async () => {
      events.push('service.onDestroy')
    })
    try {
      @Injectable()
      class UsersService {
        db = inject(drizzleDb(name))

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
      @Module({ imports: [UsersModule, DrizzleModule.configure(pg('postgres://localhost/test'), { name })] })
      class Root {}

      const app = createApp(Root)
      await app.init()
      await app.destroy()
      return events
    } finally {
      onInit.mockRestore()
      onDestroy.mockRestore()
    }
  }

  it('runs the hooks of a provider injecting drizzleDb() inside the connection window', async () => {
    expect(await hookEvents()).toEqual(['service.onInit', 'user.onInit', 'user.onDestroy', 'service.onDestroy'])
  })

  it('does the same for a named connection', async () => {
    expect(await hookEvents('analytics')).toEqual([
      'service.onInit',
      'user.onInit',
      'user.onDestroy',
      'service.onDestroy',
    ])
  })
})

describe('DrizzleModule without configure', () => {
  it('names the configure() call when drizzleDb() has no provider', () => {
    const app = new Miia({ logger: false })
    expect(() => app.get(drizzleDb())).toThrow('drizzleDb(default) is provided by DrizzleModule.configure()')
  })

  it('names the configure() call with the name when drizzleDb(name) has no provider', () => {
    const app = new Miia({ logger: false })
    expect(() => app.get(drizzleDb('analytics'))).toThrow(
      "drizzleDb(analytics) is provided by DrizzleModule.configure(opts, { name: 'analytics' })",
    )
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
