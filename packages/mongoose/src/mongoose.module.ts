import type { ConfiguredModule, Constructor, FactoryProvider, OptionsOrFactory } from '@miiajs/core'
import { resolveOptions } from '@miiajs/core'
import type mongoose from 'mongoose'
import type { MongooseModuleOptions } from './types.js'
import type { ModelToken } from './define-model.js'
import { MongooseService } from './mongoose.service.js'
import { getInternalServiceToken, getRegistryToken, mongooseConnection } from './tokens.js'

// ─── Lazy proxies ────────────────────────────────────────────────────────────
// MongooseService.onInit happens AFTER provider factories run, so we can't
// return a real Connection / Model from the factory. Proxy defers underlying
// lookup until first property access.

function createLazyProxy<T extends object>(get: () => T): T {
  let cached: T | undefined
  const resolve = () => (cached ??= get())
  return new Proxy({} as T, {
    get(_, prop) {
      const target = resolve() as any
      const value = target[prop]
      return typeof value === 'function' ? value.bind(target) : value
    },
    has(_, prop) {
      return prop in (resolve() as any)
    },
    ownKeys() {
      return Reflect.ownKeys(resolve() as any)
    },
    getOwnPropertyDescriptor(_, prop) {
      return Object.getOwnPropertyDescriptor(resolve() as any, prop)
    },
  })
}

// Mongoose-specific Model proxy: callable target so we can intercept `new`
// (mongoose's `new User({...})` document idiom) and forwards prototype lookup
// so `doc instanceof UserModel` keeps working.
function createMongooseModelProxy(get: () => mongoose.Model<any>): mongoose.Model<any> {
  let cached: mongoose.Model<any> | undefined
  const resolve = () => (cached ??= get())
  // Wrap a function so the proxy is callable / constructable, matching mongoose's runtime shape.
  const target = function () {} as unknown as mongoose.Model<any>
  return new Proxy(target, {
    get(_, prop) {
      const model = resolve() as any
      const value = model[prop]
      return typeof value === 'function' ? value.bind(model) : value
    },
    has(_, prop) {
      return prop in (resolve() as any)
    },
    ownKeys() {
      return Reflect.ownKeys(resolve() as any)
    },
    getOwnPropertyDescriptor(_, prop) {
      return Object.getOwnPropertyDescriptor(resolve() as any, prop)
    },
    getPrototypeOf() {
      return Object.getPrototypeOf(resolve())
    },
    construct(_, args) {
      const ModelCtor = resolve() as unknown as new (...a: any[]) => any
      return new ModelCtor(...args)
    },
  })
}

// ─── Cross-connection collision warning ──────────────────────────────────────

const seenTokens = new WeakMap<ModelToken<any>, string>()

function checkCrossConnectionCollision(models: ModelToken<any>[], conn: string): void {
  for (const token of models) {
    const previous = seenTokens.get(token)
    if (previous !== undefined && previous !== conn) {
      const fmt = (n: string) => (n === '' ? 'default' : n)
      console.warn(
        `[Miia/Mongoose] Token ${token.name} registered in connections "${fmt(previous)}" and "${fmt(conn)}". ` +
          `Use a separate defineModel(...) per connection.`,
      )
    }
    seenTokens.set(token, conn)
  }
}

// ─── Friendly error helper ───────────────────────────────────────────────────

function configureMissingError(name: string | undefined, suffix: string): Error {
  return new Error(
    `[Miia/Mongoose] ${suffix} ` +
      `MongooseModule.configure() is missing in the root module${name ? ` for connection "${name}"` : ''}.`,
  )
}

// ─── MongooseModule ──────────────────────────────────────────────────────────

export class MongooseModule {
  static configure(optionsOrFactory: OptionsOrFactory<MongooseModuleOptions>, name?: string): ConfiguredModule {
    const serviceToken = getInternalServiceToken(name)
    const registryToken = getRegistryToken(name)
    const connToken = mongooseConnection(name)

    const ModuleClass = name ? (class MongooseNamedModule {} as Constructor) : MongooseModule

    return {
      module: ModuleClass,
      providers: [
        {
          token: registryToken,
          factory: () => new Map<ModelToken<any>, ModelToken<any>>(),
        } satisfies FactoryProvider,
        {
          token: serviceToken,
          factory: (resolve) => {
            const options = resolveOptions(optionsOrFactory, { resolve })
            const registry = resolve<Map<ModelToken<any>, ModelToken<any>>>(registryToken)
            return new MongooseService(options, registry)
          },
        } satisfies FactoryProvider,
        {
          token: connToken,
          factory: (resolve) => {
            return createLazyProxy<mongoose.Connection>(() => resolve<MongooseService>(serviceToken).connection)
          },
        } satisfies FactoryProvider,
      ],
    }
  }

  static register(models: ModelToken<any>[], name?: string): ConfiguredModule {
    const serviceToken = getInternalServiceToken(name)
    const registryToken = getRegistryToken(name)
    const conn = name ?? ''

    checkCrossConnectionCollision(models, conn)

    const FeatureModule = class MongooseFeatureModule {} as Constructor

    const providers: FactoryProvider[] = models.map((token) => ({
      token,
      factory: (resolve) => {
        let service: MongooseService
        let registry: Map<ModelToken<any>, ModelToken<any>>
        try {
          service = resolve<MongooseService>(serviceToken)
          registry = resolve<Map<ModelToken<any>, ModelToken<any>>>(registryToken)
        } catch {
          throw configureMissingError(name, `inject(${token.name}) failed:`)
        }
        registry.set(token, token)
        return createMongooseModelProxy(() => service.getModel(token))
      },
    }))

    return {
      module: FeatureModule,
      providers,
    }
  }
}
