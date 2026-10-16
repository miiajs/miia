import type { ConfiguredModule, FactoryProvider, OptionsOrFactory } from '@miiajs/core'
import { createLazyProxy, resolveOptions } from '@miiajs/core'
import type { DrizzleModuleOptions } from './types.js'
import { DrizzleService } from './drizzle.service.js'
import { configureCall, drizzleDb, getInternalServiceToken } from './tokens.js'

// ─── Friendly error helper ───────────────────────────────────────────────────

function configureMissingError(name: string | undefined, suffix: string): Error {
  return new Error(`[Miia/Drizzle] ${suffix} ${configureCall(name)} is missing in the root module.`)
}

// ─── DrizzleModule ───────────────────────────────────────────────────────────

export class DrizzleModule {
  static configure(
    optionsOrFactory: OptionsOrFactory<DrizzleModuleOptions>,
    options?: { name?: string; global?: boolean },
  ): ConfiguredModule {
    const name = options?.name || undefined
    const serviceToken = getInternalServiceToken(name)
    const dbToken = drizzleDb(name)

    return {
      module: DrizzleModule,
      name,
      global: options?.global,
      exports: [dbToken],
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
          deps: [serviceToken],
          factory: (resolve) => {
            // DrizzleService.onInit runs after provider factories, so the db handle is looked up on first use;
            // deps orders its hooks before those of anything that injects the db
            return createLazyProxy<object>(() => {
              let service: DrizzleService
              try {
                service = resolve(serviceToken)
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
