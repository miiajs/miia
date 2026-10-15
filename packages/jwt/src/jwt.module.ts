import type { ConfiguredModule, OptionsOrFactory } from '@miiajs/core'
import { provider, resolveOptions } from '@miiajs/core'
import type { JwtOptions } from './jwt.types.js'
import { JwtService } from './jwt.service.js'
import { JWT_OPTIONS } from './constants.js'

export class JwtModule {
  static configure(optionsOrFactory: OptionsOrFactory<JwtOptions>): ConfiguredModule {
    return {
      module: JwtModule,
      providers: [
        provider(JWT_OPTIONS, (resolve) => resolveOptions(optionsOrFactory, { resolve })),
        {
          token: JwtService,
          factory: () => new JwtService(),
        },
      ],
    }
  }
}
