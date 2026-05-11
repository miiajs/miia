/**
 * Pluggable idempotency primitive used by `@Idempotent` handlers in MessageBus.
 *
 * `claim(id, ttl)` is the atomic "first time?" check; `release(id)` lets the
 * next retry attempt re-claim after a handler error. The store is transport-
 * agnostic - a Redis Streams transport may pair with a Postgres-backed store,
 * a NATS transport may use the broker's native dedup window plus a memory
 * store for cross-restart safety.
 *
 * Implementations shipped:
 * - `memoryIdempotencyStore()` - in-process Map with LRU eviction; default
 *   for dev/tests; not safe across processes.
 * - `redisIdempotencyStore()` from `@miiajs/messaging-redis` - production-ready,
 *   atomic via SET NX EX.
 *
 * Custom backends (Postgres `INSERT ON CONFLICT`, DynamoDB conditional put)
 * implement this interface directly.
 */
export interface IdempotencyStore {
  /**
   * Try to claim an ID for the given TTL (in milliseconds).
   *
   * - returns `true` → first claim, the framework proceeds with the handler
   * - returns `false` → already claimed, the handler is silently skipped
   *   (treated as "already processed")
   *
   * Must be atomic: concurrent calls with the same id must produce exactly
   * one `true` and the rest `false`.
   */
  claim(id: string, ttlMs: number): Promise<boolean>

  /**
   * Release a previously-claimed id so a future delivery can re-claim.
   * Called by MessageBus when the handler errors. Idempotent (no-op if id
   * is not present).
   */
  release(id: string): Promise<void>

  onDestroy?(): Promise<void>
}

/**
 * DI token for the optional idempotency store.
 *
 * Always registered by `MessagingModule.configure()` (value is `null` when
 * the user did not configure one). MessageBus reads it via `injectOptional`
 * and only uses the store when a handler has `@Idempotent`.
 */
export const IDEMPOTENCY_STORE = 'miia:messaging:idempotency-store'

// ─── In-memory implementation ──────────────────────────────────────

export interface MemoryIdempotencyStoreOptions {
  /**
   * Max entries kept before LRU eviction. Default 10000.
   *
   * If an entry is evicted before its TTL, a duplicate may be re-processed.
   * Acceptable trade-off for in-process stores; production deployments
   * should use a Redis-backed store with bounded memory pressure.
   */
  maxSize?: number
}

const DEFAULT_MAX_SIZE = 10_000

export class MemoryIdempotencyStore implements IdempotencyStore {
  private entries = new Map<string, number>() // id → expiresAtMs
  private maxSize: number

  constructor(options: MemoryIdempotencyStoreOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE
  }

  async claim(id: string, ttlMs: number): Promise<boolean> {
    const now = Date.now()
    const existing = this.entries.get(id)
    if (existing !== undefined && existing > now) return false

    // Stale entry treated as absent. Delete-then-set keeps Map insertion
    // order accurate for LRU eviction below.
    this.entries.delete(id)
    this.entries.set(id, now + ttlMs)

    if (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    return true
  }

  async release(id: string): Promise<void> {
    this.entries.delete(id)
  }

  async onDestroy(): Promise<void> {
    this.entries.clear()
  }
}

export function memoryIdempotencyStore(options?: MemoryIdempotencyStoreOptions): IdempotencyStore {
  return new MemoryIdempotencyStore(options)
}
