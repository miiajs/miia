import { createMethodDecorator, pushMeta, setInMapMeta, type DiscoverableMethodMeta } from '@miiajs/core'
import type { DispatchMode, MessageMeta } from './types.js'

export const ON = Symbol('miia:messaging:on')

export const IDEMPOTENT = Symbol('miia:messaging:idempotent')

export interface OnMeta extends DiscoverableMethodMeta {
  topic: string
  /**
   * Explicit broker consumer group (competing-consumers worker pool). When
   * omitted, the bus auto-derives a per-handler group `<topic>__<Class>_<method>`
   * (optionally `<appName>:` prefixed). Setting this option puts multiple
   * handlers (across classes or replicas) into the same broker group so the
   * broker round-robins each message to one of them. Requires
   * `transport.supportsCompetingConsumers === true`.
   */
  group?: string
  concurrency?: number
  /**
   * Target bus name when multiple `MessagingModule.configure(opts, name)` are
   * registered. Omit (or `undefined`) to target the default bus. Throws at
   * startup if the referenced bus name has no matching `MessagingModule`.
   */
  bus?: string
  /**
   * Per-handler override of the bus / transport dispatch mode. Resolution
   * order: this field > `MessagingModule.configure({ dispatch: { mode } })` >
   * `transport.defaultMode`. Validated against `transport.supportedModes` at
   * `MessageBus.onReady()`.
   */
  mode?: DispatchMode
  /**
   * Cluster-wide fan-out for this handler. When `true`, the auto-derived group
   * is suffixed with `__<hostname>_<pid>` so every replica gets a unique broker
   * group and the broker delivers a copy of each message to every replica.
   * Mutually exclusive with `group` - explicit `group` is for shared work
   * across handlers/replicas, broadcast replicates work to every replica.
   *
   * Use for in-process state that every replica must update on its own
   * (cache invalidation, websocket broadcast).
   */
  broadcast?: boolean
}

export interface IdempotentMeta {
  /** Claim lifetime in milliseconds. */
  ttl: number
  key?: (payload: unknown, meta: MessageMeta) => string
}

/**
 * Marks a method as a message handler for `topic`. At app startup, MessageBus
 * discovers all `@On` methods via DiscoveryService (during `onReady`) and
 * subscribes each one to the configured transport.
 *
 * @param topic   Free-form string. Transports do not interpret dots/slashes.
 * @param options.group        Explicit broker consumer group (competing-consumers
 *                             worker pool). Without it, an auto-derived
 *                             per-handler group is used.
 * @param options.concurrency  Per-handler subscription concurrency. In sliding
 *                             mode = number of lanes.
 * @param options.mode         Per-handler dispatch mode. Resolution: this
 *                             field > bus default > `transport.defaultMode`.
 * @param options.bus          Target bus for multi-bus setups.
 * @param options.broadcast    Cluster-wide fan-out (every replica gets a copy).
 *                             Mutually exclusive with `group`.
 *
 * **Subscription model.** Each `@On` becomes its own broker subscription with
 * an auto-derived consumer group `<topic>__<ClassName>_<methodName>` (or
 * `<appName>:<topic>__<ClassName>_<methodName>` if `MessagingModule.configure`
 * provides `appName`). Within one process every handler runs independently:
 * retry, ack/nack, mode/concurrency are isolated per handler.
 *
 * For replicas of the same handler running in N processes, broker round-robins
 * each message to exactly one of the N consumers (load balance scaling).
 *
 * For cluster-wide fan-out (each replica processes its own copy), set
 * `broadcast: true`. For competing-consumers worker pool across multiple
 * handler classes, pass explicit `group: 'pool-name'` (requires
 * `transport.supportsCompetingConsumers === true`).
 *
 * **Multi-topic handlers.** Decorating one method with multiple `@On` works
 * naturally - each decoration creates its own subscription with its own
 * auto-derived group. Useful when a single handler responds to several
 * topics:
 * ```ts
 * @On('user.created')
 * @On('user.updated')
 * async syncToCRM(user: User) { ... }
 * // → 2 subscriptions: user.created__SyncService_syncToCRM, user.updated__...
 * ```
 *
 * @example
 * ```ts
 * @On('user.created')                              // 1 worker, fan-out across handlers
 * @On('cache.invalidate', { broadcast: true })     // copy to every replica
 * @On('jobs', { group: 'workers' })                // explicit competing-consumers pool
 * ```
 */
export const On = createMethodDecorator<
  [
    topic: string,
    options?: { group?: string; concurrency?: number; bus?: string; mode?: DispatchMode; broadcast?: boolean },
  ]
>((_target, ctx, topic, options) => {
  pushMeta(ctx.metadata!, ON, {
    handlerName: ctx.name as string,
    topic,
    group: options?.group,
    concurrency: options?.concurrency,
    bus: options?.bus,
    mode: options?.mode,
    broadcast: options?.broadcast,
  } satisfies OnMeta)
})

/**
 * Skip the handler when the same logical message has already been processed.
 *
 * When applied to an `@On` handler, MessageBus claims an idempotency key in the
 * configured `IdempotencyStore` before invoking the handler. If the claim
 * already exists (duplicate delivery from XAUTOCLAIM, network blip, etc.),
 * the handler is silently skipped and the message is acked.
 *
 * Default key is `${envelope.id}:${ClassName}.${methodName}` - per-handler
 * scope, so two `@Idempotent` handlers on the same topic do NOT conflict
 * by default. Pass an explicit `key` to override (for example, dedupe on a
 * business identifier from payload, or share a single key across handlers).
 *
 * **NOT exactly-once.** If the consumer crashes after `claim()` but before
 * the message is acked back to the broker, the claim stays in the store
 * while the broker still considers the message un-acked. After redelivery
 * the next consumer sees a stale claim and skips the handler, effectively
 * losing the message. For business-critical workflows pair `@Idempotent`
 * with a transactional outbox or use idempotent-by-design handlers
 * (`UPDATE WHERE id=?`) instead.
 *
 * @example
 * ```ts
 * @Injectable()
 * class PaymentService {
 *   @On('order.placed')
 *   @Idempotent({ ttl: 24 * 60 * 60 * 1000 }) // dedupe within 24h
 *   async chargeCard(order: Order) {
 *     await this.payments.charge(order.cardId, order.total)
 *   }
 *
 *   // Custom key when the upstream may republish the same business event
 *   // with different envelope.id values:
 *   @On('payment.received')
 *   @Idempotent({ ttl: 24 * 60 * 60 * 1000, key: (p: Payment) => `payment:${p.transactionId}` })
 *   async onPayment(payment: Payment) { ... }
 * }
 * ```
 *
 * @throws at app startup if any `@Idempotent` handler exists but no
 *   `IdempotencyStore` was passed to `MessagingModule.configure()`.
 */
export const Idempotent = createMethodDecorator<
  [options: { ttl: number; key?: (payload: unknown, meta: MessageMeta) => string }]
>((_target, ctx, options) => {
  setInMapMeta(ctx.metadata!, IDEMPOTENT, String(ctx.name), {
    ttl: options.ttl,
    key: options.key,
  } satisfies IdempotentMeta)
})
