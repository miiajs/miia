import { Module } from '@miiajs/core'
import { ConfigModule, ConfigService } from '@miiajs/config'
import { MongooseModule } from '@miiajs/mongoose'
import { envSchema } from './env.schema'
import { UserModule } from './user/user.module'

@Module({
  imports: [
    ConfigModule.configure({ schema: envSchema }, { global: true }),
    MongooseModule.configure(
      (resolve) => {
        const config = resolve(ConfigService)
        return { uri: config.getOrThrow('MONGODB_URL') }
      },
      { global: true },
    ),
    UserModule,
  ],
})
export class AppModule {}
