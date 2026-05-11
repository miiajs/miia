import { Module } from '@miiajs/core'
import { ConfigModule, ConfigService } from '@miiajs/config'
import { MessagingModule, inMemoryTransport, memoryIdempotencyStore } from '@miiajs/messaging'
import { redisStreamsTransport, redisIdempotencyStore } from '@miiajs/messaging-redis'
import { envSchema, type Env } from '../env.schema.js'
import { OrdersModule } from '../orders/orders.module.js'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'

@Module({
  imports: [
    ConfigModule.configure({ schema: envSchema }),
    MessagingModule.configure({
      transport: inMemoryTransport({
        retry: { maxAttempts: 3, backoffMs: 100, backoffMultiplier: 2 },
      }),
      idempotency: memoryIdempotencyStore({ maxSize: 1000 }),
    }),
    MessagingModule.configure((resolve) => {
      const config = resolve(ConfigService<Env>)
      const url = config.getOrThrow('REDIS_URL')
      return {
        transport: redisStreamsTransport({
          url,
          retry: { maxAttempts: 2, backoffMs: 500, backoffMultiplier: 2, dlq: true },
        }),
        idempotency: redisIdempotencyStore({ url, keyPrefix: 'messaging-app:idem:' }),
        // appName prefixes auto-derived consumer groups so multiple services
        // sharing this Redis don't collide on handler class names. Explicit
        // groups (analytics, payments) remain unprefixed.
        appName: 'messaging-app',
      }
    }, 'redis'),
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
