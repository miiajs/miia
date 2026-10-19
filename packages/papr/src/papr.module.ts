import type { ConfiguredModule, Constructor, FactoryProvider, OptionsOrFactory } from '@miiajs/core'
import { createLazyProxy, provider, resolveOptions } from '@miiajs/core'
import type { Db } from 'mongodb'
import type { Model } from 'papr'
import type { PaprModuleOptions } from './types.js'
import type { ModelToken } from './define-model.js'
import { PaprService } from './papr.service.js'
import { configureCall, getInternalServiceToken, getRegistryToken, paprDb } from './tokens.js'

// ─── Friendly error helpers ──────────────────────────────────────────────────

function configureMissingError(name: string | undefined, suffix: string): Error {
  return new Error(`[Miia/Papr] ${suffix} ${configureCall(name)} is missing in the root module.`)
}

// ─── PaprModule ──────────────────────────────────────────────────────────────

export class PaprModule {
  static configure(
    optionsOrFactory: OptionsOrFactory<PaprModuleOptions>,
    options?: { name?: string; global?: boolean },
  ): ConfiguredModule {
    const name = options?.name || undefined
    const serviceToken = getInternalServiceToken(name)
    const registryToken = getRegistryToken(name)
    const dbToken = paprDb(name)

    return {
      module: PaprModule,
      name,
      global: options?.global,
      // The internal tokens too: the model factories of register() reach them through the module that imports it
      exports: [dbToken, serviceToken, registryToken],
      providers: [
        {
          token: registryToken,
          factory: () => new Map<ModelToken<any, any>, ModelToken<any, any>>(),
        } satisfies FactoryProvider,
        {
          token: serviceToken,
          factory: (resolve) => {
            const options = resolveOptions(optionsOrFactory, { resolve })
            const registry = resolve(registryToken)
            return new PaprService(options, registry)
          },
        } satisfies FactoryProvider,
        {
          token: dbToken,
          deps: [serviceToken],
          factory: (resolve) => {
            // PaprService.onInit runs after provider factories, so the Db / Model is looked up on first use;
            // deps orders its hooks before those of anything that injects the Db
            return createLazyProxy<Db>(() => resolve(serviceToken).db)
          },
        } satisfies FactoryProvider,
      ],
    }
  }

  static register(models: ModelToken<any, any>[], options?: { name?: string }): ConfiguredModule {
    const name = options?.name || undefined
    const serviceToken = getInternalServiceToken(name)
    const registryToken = getRegistryToken(name)
    const shared = `connection '${name ?? 'default'}'`

    const FeatureModule = class PaprFeatureModule {} as Constructor
    // How errors and the start-up log name this module
    const listed = models.map((token) => token.collectionName).join(', ')
    Object.defineProperty(FeatureModule, 'name', {
      value: `PaprModule.register([${listed}]${name ? `, { name: '${name}' }` : ''})`,
    })

    const providers: FactoryProvider[] = models.map((token) =>
      provider(
        token,
        (resolve) => {
          let service: PaprService
          let registry: Map<ModelToken<any, any>, ModelToken<any, any>>
          try {
            service = resolve(serviceToken)
            registry = resolve(registryToken)
          } catch {
            throw configureMissingError(name, `inject(${token.name}) failed:`)
          }
          registry.set(token, token)
          return createLazyProxy<Model<any, any>>(() => service.getModel(token))
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
