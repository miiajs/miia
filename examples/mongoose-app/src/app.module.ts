import { Module } from '@miiajs/core'
import { ConfigModule, ConfigService } from '@miiajs/config'
import { MongooseModule } from '@miiajs/mongoose'
import { envSchema } from './env.schema'
import { UserModule } from './user/user.module'

@Module({
  imports: [
    ConfigModule.configure({ schema: envSchema }),
    MongooseModule.configure((resolve) => {
      const config = resolve(ConfigService)
      return { uri: config.getOrThrow('MONGODB_URL') }
    }),
    UserModule,
  ],
})
export class AppModule {}
