import { Logger } from '@miiajs/core'
import type { IdempotencyStore } from '@miiajs/messaging'
import { Redis } from 'ioredis'
import { describeError } from './connection.js'

export interface RedisIdempotencyStoreOptions {
  /** Pre-built ioredis instance. Mutually exclusive with `url`. */
  client?: Redis
  /** Redis URL (e.g. `redis://localhost:6379`). Used when `client` is omitted. */
  url?: string
  /**
   * Key prefix in Redis. Default `'miia:idem:'`.
   *
   * Use a per-service prefix when multiple services share a Redis instance,
   * e.g. `'orders-svc:idem:'`, so claims do not collide across services.
   */
  keyPrefix?: string
}

const DEFAULT_KEY_PREFIX = 'miia:idem:'

/**
 * Redis-backed idempotency store. `claim()` is `SET key 1 NX PX <ttlMs>` -
 * atomic, so concurrent claims for the same id produce exactly one `true`.
 * `release()` is `DEL key`. Keys auto-expire after `ttlMs`.
 *
 * Pair with any `MessageTransport` (Redis Streams, NATS, in-memory, etc.) -
 * the store is transport-agnostic.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  private client: Redis
  private ownsClient: boolean
  private prefix: string
  private logger = new Logger('RedisIdempotencyStore')
  /** Connection errors since the client was last ready. Only the first of an outage is logged. */
  private connectionErrors = 0

  constructor(options: RedisIdempotencyStoreOptions) {
    if (!options.client && !options.url) {
      throw new Error('[messaging-redis] redisIdempotencyStore: either `url` or `client` must be provided')
    }
    if (options.client) {
      this.client = options.client
      this.ownsClient = false
    } else {
      this.client = new Redis(options.url!, { lazyConnect: true })
      this.ownsClient = true
      this.watchConnection()
    }
    this.prefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX
  }

  async claim(id: string, ttlMs: number): Promise<boolean> {
    const reply = await this.client.set(`${this.prefix}${id}`, '1', 'PX', ttlMs, 'NX')
    return reply === 'OK'
  }

  async release(id: string): Promise<void> {
    await this.client.del(`${this.prefix}${id}`)
  }

  /** Without a listener, ioredis prints a stack on every reconnect attempt. A `client` you pass keeps its own. */
  private watchConnection(): void {
    this.client.on('error', (err) => {
      if (this.connectionErrors++ === 0) this.logger.error('Redis connection error', describeError(err))
    })
    this.client.on('ready', () => {
      if (this.connectionErrors > 1) this.logger.log(`Redis connection recovered after ${this.connectionErrors} errors`)
      this.connectionErrors = 0
    })
  }

  async onDestroy(): Promise<void> {
    if (this.ownsClient && this.client.status !== 'end') {
      await this.client.quit().catch(() => {
        /* swallow quit errors - connection already closing */
      })
    }
  }
}

export function redisIdempotencyStore(options: RedisIdempotencyStoreOptions): IdempotencyStore {
  return new RedisIdempotencyStore(options)
}
