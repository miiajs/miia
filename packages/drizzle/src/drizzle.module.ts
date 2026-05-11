import type { ConfiguredModule, Constructor, FactoryProvider, OptionsOrFactory } from '@miiajs/core'
import { resolveOptions } from '@miiajs/core'
import type { DrizzleModuleOptions } from './types.js'
import { DrizzleService } from './drizzle.service.js'
import { drizzleDb, getInternalServiceToken } from './tokens.js'

// ─── Lazy proxies ────────────────────────────────────────────────────────────
// DrizzleService.onInit happens AFTER provider factories run, so we can't return
// a real db handle from the factory. The proxy defers underlying lookup until
// first property access.

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
