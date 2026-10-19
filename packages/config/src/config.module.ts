import type { ConfiguredModule, OptionsOrFactory, ZodLike } from '@miiajs/core'
import { injectOptional, provider, resolveOptions } from '@miiajs/core'
import { ConfigService } from './config.service.js'
import type { ConfigToken } from './define-config.js'
import { deepFrozenCopy } from './freeze.js'
import { parseEnv } from './parse-env.js'
import { CONFIG_OPTIONS, CONFIG_SOURCE, CONFIG_VALUES } from './tokens.js'

export interface ConfigModuleOptions {
  schema?: ZodLike
  env?: Record<string, string | undefined>
}

export class ConfigModule {
  static configure(
    optionsOrFactory: OptionsOrFactory<ConfigModuleOptions> = {},
    options?: { global?: boolean },
  ): ConfiguredModule {
    return {
      module: ConfigModule,
      global: options?.global,
      // CONFIG_SOURCE too: the factories of register() read the env through the module that imports them
      exports: [ConfigService, CONFIG_SOURCE],
      providers: [
        provider(CONFIG_OPTIONS, (resolve) => resolveOptions(optionsOrFactory, { resolve })),
        // a holder, so process.env itself never becomes an instance the container probes
        provider(CONFIG_SOURCE, (resolve) => Object.freeze({ env: resolve(CONFIG_OPTIONS).env ?? process.env })),
        provider(CONFIG_VALUES, (resolve) => {
          const { schema } = resolve(CONFIG_OPTIONS)
          const { env } = resolve(CONFIG_SOURCE)
          return schema ? deepFrozenCopy(parseEnv(schema, env)) : Object.freeze({ ...env })
        }),
        ConfigService,
      ],
    }
  }

  /**
   * Provides a feature config from `defineConfig()`, validated against the env of the root
   * `ConfigModule.configure()` (`process.env` without one). Every module that registers it gets one instance.
   */
  static register<T>(config: ConfigToken<T>): ConfiguredModule {
    const FeatureModule = class ConfigFeatureModule {}
    // How errors and the start-up log name this module
    Object.defineProperty(FeatureModule, 'name', { value: `ConfigModule.register(${config.configName})` })

    return {
      module: FeatureModule,
      exports: [config],
      providers: [
        provider(
          config,
          () => {
            const env = injectOptional(CONFIG_SOURCE)?.env ?? process.env
            return deepFrozenCopy(parseEnv(config.schema, env, config.configName))
          },
          { shared: 'config' },
        ),
      ],
    }
  }
}
