import { Module } from '@miiajs/core'
import { ConfigModule, ConfigService } from '@miiajs/config'
import { PaprModule } from '@miiajs/papr'
import { envSchema } from './env.schema'
import { UserModule } from './user/user.module'

@Module({
  imports: [
    ConfigModule.configure({ schema: envSchema }, { global: true }),
    PaprModule.configure(
      (resolve) => {
        const config = resolve(ConfigService)
        return { connection: { url: config.getOrThrow('MONGODB_URL') } }
      },
      { global: true },
    ),
    UserModule,
  ],
})
export class AppModule {}
