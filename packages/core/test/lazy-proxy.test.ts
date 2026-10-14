import { describe, expect, it } from 'bun:test'
import type { ConfiguredModule } from '../src/index.js'
import { createLazyProxy, inject, Injectable, Miia, Module } from '../src/index.js'

class Database {
  tables = { users: { findMany: () => ['ann'] } }

  select() {
    return this
  }
}

interface UserModel {
  find(): string
}

class ModelService {
  private models = new Map<string, UserModel>()

  async onInit() {
    this.models.set('User', { find: () => 'rows' })
  }

  async onDestroy() {
    this.models.clear()
  }

  getModel(name: string): UserModel {
    const model = this.models.get(name)
    if (!model) throw new Error(`Model "${name}" not initialized`)
    return model
  }
}

function dbModule(): ConfiguredModule {
  return {
    module: class DbModule {},
    providers: [{ token: 'ModelService', factory: () => new ModelService() }],
  }
}

function featureModule(counter: { resolves: number }): ConfiguredModule {
  return {
    module: class FeatureModule {},
    providers: [
      {
        token: 'User',
        factory: (resolve) => {
          const service = resolve<ModelService>('ModelService')
          return createLazyProxy(() => {
            counter.resolves++
            return service.getModel('User')
          })
        },
      },
    ],
  }
}

describe('createLazyProxy', () => {
  it('answers lifecycle probes, constructor and prototype without resolving', () => {
    let resolves = 0
    const proxy = createLazyProxy(() => {
      resolves++
      return new Database()
    }) as Database & Record<string, unknown>

    expect(proxy.onInit).toBeUndefined()
    expect(proxy.onReady).toBeUndefined()
    expect(proxy.onShutdown).toBeUndefined()
    expect(proxy.onDestroy).toBeUndefined()
    expect(proxy.constructor).toBe(Object)
    expect(Object.getPrototypeOf(proxy)).toBe(Object.prototype)
    expect(resolves).toBe(0)

    expect(proxy.tables.users.findMany()).toEqual(['ann'])
    expect(proxy.select()).toBeInstanceOf(Database)
    expect(resolves).toBe(1)
  })

  it('forwards to the real value after resolving', () => {
    const real = new Database()
    const proxy = createLazyProxy(() => real)

    expect(proxy.select()).toBe(real)
    expect(proxy.constructor).toBe(Database)
    expect(Object.getPrototypeOf(proxy)).toBe(Database.prototype)
    expect(proxy).toBeInstanceOf(Database)
  })

  it('constructs the resolved class when constructable', () => {
    class Model {
      constructor(public name: string) {}
    }

    let resolves = 0
    const proxy = createLazyProxy(
      () => {
        resolves++
        return Model
      },
      { constructable: true },
    )

    expect(typeof proxy).toBe('function')
    expect(proxy.constructor).toBe(Function)
    expect(Object.getPrototypeOf(proxy)).toBe(Function.prototype)
    expect(resolves).toBe(0)

    const doc = new proxy('ann')
    expect(doc).toBeInstanceOf(Model)
    expect(doc instanceof proxy).toBe(true)
    expect(doc.name).toBe('ann')
    expect(resolves).toBe(1)
  })

  it('does not resolve during init() when the feature module is imported before the service module', async () => {
    const counter = { resolves: 0 }

    @Injectable()
    class UserRepository {
      users = inject<UserModel>('User')
    }

    @Module({ imports: [featureModule(counter)], providers: [UserRepository] })
    class UserModule {}

    @Module({ imports: [UserModule, dbModule()] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    expect(counter.resolves).toBe(0)

    expect(app.get(UserRepository).users.find()).toBe('rows')
    expect(counter.resolves).toBe(1)
    await app.destroy()
  })

  it('does not resolve during destroy() after the service has torn the value down', async () => {
    const counter = { resolves: 0 }

    @Module({ imports: [dbModule(), featureModule(counter)] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    await app.destroy()
    expect(counter.resolves).toBe(0)
  })
})
