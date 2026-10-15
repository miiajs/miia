import type { ConfiguredModule, Constructor, FactoryProvider, OptionsOrFactory } from '@miiajs/core'
import { createLazyProxy, resolveOptions } from '@miiajs/core'
import type mongoose from 'mongoose'
import type { MongooseModuleOptions } from './types.js'
import type { ModelToken } from './define-model.js'
import { MongooseService } from './mongoose.service.js'
import { configureCall, getInternalServiceToken, getRegistryToken, mongooseConnection } from './tokens.js'

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
  return new Error(`[Miia/Mongoose] ${suffix} ${configureCall(name)} is missing in the root module.`)
}

// ─── MongooseModule ──────────────────────────────────────────────────────────

export class MongooseModule {
  static configure(
    optionsOrFactory: OptionsOrFactory<MongooseModuleOptions>,
    options?: { name?: string },
  ): ConfiguredModule {
    const name = options?.name || undefined
    const serviceToken = getInternalServiceToken(name)
    const registryToken = getRegistryToken(name)
    const connToken = mongooseConnection(name)

    return {
      module: MongooseModule,
      name,
      providers: [
        {
          token: registryToken,
          factory: () => new Map<ModelToken<any>, ModelToken<any>>(),
        } satisfies FactoryProvider,
        {
          token: serviceToken,
          factory: (resolve) => {
            const options = resolveOptions(optionsOrFactory, { resolve })
            const registry = resolve(registryToken)
            return new MongooseService(options, registry)
          },
        } satisfies FactoryProvider,
        {
          token: connToken,
          factory: (resolve) => {
            // MongooseService.onInit runs after provider factories, so the Connection is looked up on first use
            return createLazyProxy<mongoose.Connection>(() => resolve(serviceToken).connection)
          },
        } satisfies FactoryProvider,
      ],
    }
  }

  static register(models: ModelToken<any>[], options?: { name?: string }): ConfiguredModule {
    const name = options?.name || undefined
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
          service = resolve(serviceToken)
          registry = resolve(registryToken)
        } catch {
          throw configureMissingError(name, `inject(${token.name}) failed:`)
        }
        registry.set(token, token)
        // Constructable for the injected model's `new this.users({...})`; `doc instanceof this.users` keeps working
        return createLazyProxy<mongoose.Model<any>>(() => service.getModel(token), { constructable: true })
      },
    }))

    return {
      module: FeatureModule,
      providers,
    }
  }
}
