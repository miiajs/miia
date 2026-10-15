import type { ConfiguredModule, OptionsOrFactory } from '@miiajs/core'
import { createToken, resolveOptions } from '@miiajs/core'
import { SwaggerService } from './swagger.service.js'
import type { SwaggerSetupOptions } from './types.js'

export const SWAGGER_OPTIONS = createToken<SwaggerSetupOptions>('SwaggerOptions', { hint: 'SwaggerModule.configure()' })

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
