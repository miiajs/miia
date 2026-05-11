import { Module } from '@miiajs/core'
import { ConfigModule, ConfigService } from '@miiajs/config'
import { DrizzleModule } from '@miiajs/drizzle'
import { envSchema } from './env.schema'
import * as schema from './db.schema'
import { UserModule } from './user/user.module'

@Module({
  imports: [
    ConfigModule.configure({ schema: envSchema }),
    DrizzleModule.configure((resolve) => {
      const config = resolve(ConfigService)
      return {
        dialect: 'postgres',
        connection: { url: config.getOrThrow('DATABASE_URL') },
        schema,
      }
    }),
    UserModule,
  ],
})
export class AppModule {}
