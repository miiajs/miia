import type { ConfiguredModule, FactoryProvider, OptionsOrFactory, ZodLike } from '@miiajs/core'
import { resolveOptions } from '@miiajs/core'
import { ConfigService } from './config.service.js'

export interface ConfigModuleOptions {
  schema?: ZodLike
  env?: Record<string, string | undefined>
}

export class ConfigModule {
  static configure(optionsOrFactory: OptionsOrFactory<ConfigModuleOptions> = {}): ConfiguredModule {
    return {
      module: ConfigModule,
      providers: [
        {
          token: 'CONFIG_VALUES',
          factory: (resolve) => {
            const options = resolveOptions(optionsOrFactory, { resolve })
            const env = options.env ?? process.env
            if (!options.schema) {
              return env
            }
            const result = options.schema.safeParse(env)
            if (!result.success) {
              const messages = result.error.issues
                .map((i) => `  - ${i.path?.map(String).join('.') ?? '?'}: ${i.message}`)
                .join('\n')
              throw new Error(`[Miia] Config validation failed:\n${messages}`)
            }
            return result.data
          },
        } satisfies FactoryProvider,
        ConfigService,
      ],
    }
  }
}
