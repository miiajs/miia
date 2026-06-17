import type { ConfiguredModule, FactoryProvider, OptionsOrFactory } from '@miiajs/core'
import { resolveOptions } from '@miiajs/core'
import { RATE_LIMIT_OPTIONS } from './constants.js'
import type { RateLimitModuleOptions } from './guard.js'
import { MemoryStore } from './memory-store.js'

export class RateLimitModule {
  static configure(optionsOrFactory: OptionsOrFactory<RateLimitModuleOptions>): ConfiguredModule {
    return {
      module: RateLimitModule,
      providers: [
        {
          token: RATE_LIMIT_OPTIONS,
          factory: (resolve) => {
            const opts = resolveOptions(optionsOrFactory, { resolve })
            // Singleton -> the store is shared across all guards resolved from this module.
            return { ...opts, store: opts.store ?? new MemoryStore() }
          },
        } satisfies FactoryProvider,
      ],
    }
  }
}
