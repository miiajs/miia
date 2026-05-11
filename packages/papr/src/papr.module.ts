import type { ConfiguredModule, Constructor, FactoryProvider, OptionsOrFactory } from '@miiajs/core'
import { resolveOptions } from '@miiajs/core'
import type { Db } from 'mongodb'
import type { Model } from 'papr'
import type { PaprModuleOptions } from './types.js'
import type { ModelToken } from './define-model.js'
import { PaprService } from './papr.service.js'
import { getInternalServiceToken, getRegistryToken, paprDb } from './tokens.js'

// ─── Lazy proxies ────────────────────────────────────────────────────────────
// PaprService.onInit happens AFTER provider factories run, so we can't return a
// real Db / Model from the factory. Instead, we return a Proxy that defers the
// underlying lookup until first property access.

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

// ─── Cross-connection collision warning ──────────────────────────────────────
// Module-level WeakMap. If the same ModelToken is registered under two different
// connection names, log a warning - this is almost certainly a bug (the same
// token can only resolve to one provider at a time per container).

const seenTokens = new WeakMap<ModelToken<any, any>, string>()

function checkCrossConnectionCollision(models: ModelToken<any, any>[], conn: string): void {
  for (const token of models) {
    const previous = seenTokens.get(token)
    if (previous !== undefined && previous !== conn) {
      const fmt = (n: string) => (n === '' ? 'default' : n)
      console.warn(
        `[Miia/Papr] Token ${token.name} registered in connections "${fmt(previous)}" and "${fmt(conn)}". ` +
          `Use a separate defineModel(...) per connection.`,
      )
    }
    seenTokens.set(token, conn)
  }
}

// ─── Friendly error helpers ──────────────────────────────────────────────────

function configureMissingError(name: string | undefined, suffix: string): Error {
  return new Error(
    `[Miia/Papr] ${suffix} ` +
      `PaprModule.configure() is missing in the root module${name ? ` for connection "${name}"` : ''}.`,
  )
}

// ─── PaprModule ──────────────────────────────────────────────────────────────

export class PaprModule {
  static configure(optionsOrFactory: OptionsOrFactory<PaprModuleOptions>, name?: string): ConfiguredModule {
    const serviceToken = getInternalServiceToken(name)
    const registryToken = getRegistryToken(name)
    const dbToken = paprDb(name)

    const ModuleClass = name ? (class PaprNamedModule {} as Constructor) : PaprModule

    return {
      module: ModuleClass,
      providers: [
        {
          token: registryToken,
          factory: () => new Map<ModelToken<any, any>, ModelToken<any, any>>(),
        } satisfies FactoryProvider,
        {
          token: serviceToken,
          factory: (resolve) => {
            const options = resolveOptions(optionsOrFactory, { resolve })
            const registry = resolve<Map<ModelToken<any, any>, ModelToken<any, any>>>(registryToken)
            return new PaprService(options, registry)
          },
        } satisfies FactoryProvider,
        {
          token: dbToken,
          factory: (resolve) => {
            return createLazyProxy<Db>(() => resolve<PaprService>(serviceToken).db)
          },
        } satisfies FactoryProvider,
      ],
    }
  }

  static register(models: ModelToken<any, any>[], name?: string): ConfiguredModule {
    const serviceToken = getInternalServiceToken(name)
    const registryToken = getRegistryToken(name)
    const conn = name ?? ''

    checkCrossConnectionCollision(models, conn)

    const FeatureModule = class PaprFeatureModule {} as Constructor

    const providers: FactoryProvider[] = models.map((token) => ({
      token,
      factory: (resolve) => {
        let service: PaprService
        let registry: Map<ModelToken<any, any>, ModelToken<any, any>>
        try {
          service = resolve<PaprService>(serviceToken)
          registry = resolve<Map<ModelToken<any, any>, ModelToken<any, any>>>(registryToken)
        } catch {
          throw configureMissingError(name, `inject(${token.name}) failed:`)
        }
        registry.set(token, token)
        return createLazyProxy<Model<any, any>>(() => service.getModel(token))
      },
    }))

    return {
      module: FeatureModule,
      providers,
    }
  }
}
