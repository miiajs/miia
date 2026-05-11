import type { ConfiguredModule, OptionsOrFactory } from '@miiajs/core'
import { resolveOptions } from '@miiajs/core'
import { SwaggerService } from './swagger.service.js'
import type { SwaggerSetupOptions } from './types.js'

// String token - miia's DI container does not support Symbol tokens.
export const SWAGGER_OPTIONS = 'SWAGGER_OPTIONS'

export class SwaggerModule {
  static configure(optionsOrFactory: OptionsOrFactory<SwaggerSetupOptions>): ConfiguredModule {
    return {
      module: SwaggerModule,
      providers: [
        {
          token: SWAGGER_OPTIONS,
          factory: (resolve) => resolveOptions(optionsOrFactory, { resolve }),
        },
        SwaggerService,
      ],
    }
  }
}
