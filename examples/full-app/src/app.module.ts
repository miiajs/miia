import { Module } from '@miiajs/core'
import { ConfigModule, ConfigService } from '@miiajs/config'
import { type Env, envSchema } from './env.schema.js'
import { JwtModule } from '@miiajs/jwt'
import { DrizzleModule } from '@miiajs/drizzle'
import { AuthModule } from './auth/auth.module.js'
import { UsersModule } from './users/users.module.js'
import { PostsModule } from './posts/posts.module.js'
import { LimitsModule } from './limits/limits.module.js'
import { CookiesModule } from './cookies/cookies.module.js'
import { UploadsModule } from './uploads/uploads.module.js'
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
      // Swagger registers its routes with `skipGlobalPrefix: true`, so these paths are
      // taken literally: the docs stay at /api/docs even though the app's globalPrefix
      // is '/api'. The generated spec is prefix-free too, hence the '/api' on the server
      // URL below - without it "Try it out" would call /users instead of /api/users.
      path: '/api/docs/json',
      uiPath: '/api/docs',
      servers: [
        {
          url: `${resolve<ConfigService<Env>>(ConfigService).getOrThrow('PUBLIC_URL')}/api`,
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
    CookiesModule,
    UploadsModule,
    RateLimitModule.configure({
      limit: 5,
      window: '20s',
    }),
  ],
})
export class AppModule {}
