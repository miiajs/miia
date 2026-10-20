import type { ConfiguredModule, Constructor, FactoryProvider, OptionsOrFactory } from '@miiajs/core'
import { createLazyProxy, provider, resolveOptions } from '@miiajs/core'
import type mongoose from 'mongoose'
import type { MongooseModuleOptions } from './types.js'
import type { ModelToken } from './define-model.js'
import { MongooseService } from './mongoose.service.js'
import { configureCall, getInternalServiceToken, getRegistryToken, mongooseConnection } from './tokens.js'

// ─── Friendly error helper ───────────────────────────────────────────────────

function configureMissingError(name: string | undefined, suffix: string): Error {
  return new Error(`[Miia/Mongoose] ${suffix} ${configureCall(name)} is missing in the root module.`)
}

// ─── MongooseModule ──────────────────────────────────────────────────────────

export class MongooseModule {
  static configure(
    optionsOrFactory: OptionsOrFactory<MongooseModuleOptions>,
    options?: { name?: string; global?: boolean },
  ): ConfiguredModule {
    const name = options?.name || undefined
    const serviceToken = getInternalServiceToken(name)
    const registryToken = getRegistryToken(name)
    const connToken = mongooseConnection(name)

    return {
      module: MongooseModule,
      name,
      global: options?.global,
      // The internal tokens too: the model factories of register() reach them through the module that imports it
      exports: [connToken, serviceToken, registryToken],
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
          deps: [serviceToken],
          factory: (resolve) => {
            // MongooseService.onInit runs after provider factories, so the Connection is looked up on first use;
            // deps orders its hooks before those of anything that injects the Connection
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
    const shared = name ? `connection '${name}'` : 'the default connection'

    const FeatureModule = class MongooseFeatureModule {} as Constructor
    // How errors and the start-up log name this module
    const listed = models.map((token) => token.modelName).join(', ')
    Object.defineProperty(FeatureModule, 'name', {
      value: `MongooseModule.register([${listed}]${name ? `, { name: '${name}' }` : ''})`,
    })

    const providers: FactoryProvider[] = models.map((token) =>
      provider(
        token,
        (resolve) => {
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
        { shared },
      ),
    )

    return {
      module: FeatureModule,
      exports: [...models],
      providers,
    }
  }
}
