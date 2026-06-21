import { Module } from '@miiajs/core'
import { ConfigModule, ConfigService } from '@miiajs/config'
import { type Env, envSchema } from './env.schema.js'
import { JwtModule } from '@miiajs/jwt'
import { DrizzleModule } from '@miiajs/drizzle'
import { AuthModule } from './auth/auth.module.js'
import { UsersModule } from './users/users.module.js'
import { PostsModule } from './posts/posts.module.js'
import { LimitsModule } from './limits/limits.module.js'
import { SwaggerModule } from '@miiajs/swagger'
import * as schema from './db.schema.js'
import { RateLimitModule } from '@miiajs/rate-limit'

@Module({
  imports: [
    ConfigModule.configure({ schema: envSchema }),
    JwtModule.configure((resolve) => ({
      secret: resolve<ConfigService<Env>>(ConfigService).getOrThrow('JWT_SECRET'),
      expiresIn: '1h',
    })),
    DrizzleModule.configure((resolve) => ({
      dialect: 'postgres',
      connection: {
        url: resolve<ConfigService<Env>>(ConfigService).getOrThrow('DATABASE_URL'),
      },
      schema,
    })),
    SwaggerModule.configure((resolve) => ({
      title: 'Full App',
      version: '1.0.0',
      description: 'API documentation',
      path: '/api/docs/json',
      uiPath: '/api/docs',
      servers: [
        {
          url: resolve<ConfigService<Env>>(ConfigService).getOrThrow('PUBLIC_URL'),
          description: 'Current',
        },
      ],
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    })),
    AuthModule,
    UsersModule,
    PostsModule,
    LimitsModule,
    RateLimitModule.configure({
      limit: 5,
      window: '20s',
    }),
  ],
  prefix: 'api',
})
export class AppModule {}
