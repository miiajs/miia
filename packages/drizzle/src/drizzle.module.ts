import type { ConfiguredModule, Constructor, FactoryProvider, OptionsOrFactory } from '@miiajs/core'
import { createLazyProxy, resolveOptions } from '@miiajs/core'
import type { DrizzleModuleOptions } from './types.js'
import { DrizzleService } from './drizzle.service.js'
import { drizzleDb, getInternalServiceToken } from './tokens.js'

// ─── Friendly error helper ───────────────────────────────────────────────────

function configureMissingError(name: string | undefined, suffix: string): Error {
  return new Error(
    `[Miia/Drizzle] ${suffix} ` +
      `DrizzleModule.configure() is missing in the root module${name ? ` for connection "${name}"` : ''}.`,
  )
}

// ─── DrizzleModule ───────────────────────────────────────────────────────────

export class DrizzleModule {
  static configure(optionsOrFactory: OptionsOrFactory<DrizzleModuleOptions>, name?: string): ConfiguredModule {
    const serviceToken = getInternalServiceToken(name)
    const dbToken = drizzleDb(name)

    const ModuleClass = name ? (class DrizzleNamedModule {} as Constructor) : DrizzleModule

    return {
      module: ModuleClass,
      providers: [
        {
          token: serviceToken,
          factory: (resolve) => {
            const options = resolveOptions(optionsOrFactory, { resolve })
            return new DrizzleService(options)
          },
        } satisfies FactoryProvider,
        {
          token: dbToken,
          factory: (resolve) => {
            // DrizzleService.onInit runs after provider factories, so the db handle is looked up on first use
            return createLazyProxy<object>(() => {
              let service: DrizzleService
              try {
                service = resolve<DrizzleService>(serviceToken)
              } catch {
                throw configureMissingError(name, `inject(drizzleDb(${name ? `'${name}'` : ''})) failed:`)
              }
              return service.db as object
            })
          },
        } satisfies FactoryProvider,
      ],
    }
  }
}
