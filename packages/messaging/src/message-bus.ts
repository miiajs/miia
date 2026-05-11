import { randomUUID } from 'node:crypto'
import { type Constructor, DiscoveryService, getMeta, inject, Logger, Resolver } from '@miiajs/core'
import { IDEMPOTENT, type IdempotentMeta, ON, type OnMeta } from './decorators.js'
import { deriveGroupName } from './group-name.js'
import type { IdempotencyStore } from './idempotency.js'
import { getMessageBusToken } from './tokens.js'
import {
  type DispatchMode,
  type HandlerResult,
  type MessageEnvelope,
  type MessageMeta,
  type MessageTransport,
  type Subscription,
} from './types.js'

/** Bus-level dispatch defaults forwarded from `MessagingModuleOptions.dispatch`. */
interface DispatchDefaults {
  mode?: DispatchMode
  concurrency?: number
}

/** Options bag for the `MessageBus` constructor 4th argument. */
interface MessageBusOptions {
  dispatch?: DispatchDefaults | null
  appName?: string | null
}

/**
 * Central message bus. Inject from any provider:
 *
 * ```ts
 * @Injectable()
 * class OrderService {
 *   private bus = inject(MessageBus)
 *
 *   async placeOrder(order: Order) {
 *     await this.bus.publish('order.placed', order)
 *   }
 * }
 * ```
 *
 * `@On` handlers are discovered via `DiscoveryService` during `onReady()`.
 * Each `@On` becomes its own broker subscription with an auto-derived
 * consumer group `<topic>__<ClassName>_<methodName>` (or
 * `<appName>:<topic>__<ClassName>_<methodName>` when `MessagingModule.configure`
 * provides `appName`). Handlers run independently - retry, ack/nack,
 * mode/concurrency are isolated per handler.
 *
 * For multi-bus setups, use `MessagingModule.configure(opts, name)` and inject
 * the named bus via `inject<MessageBus>(getMessageBusToken(name))`. Handlers
 * target a specific bus via `@On(topic, { bus: name })`.
 *
 * `MessageBus.publish` and `MessageTransport.publish` share the method name
 * but live at different layers: `MessageBus.publish(topic, payload, meta)`
 * is the high-level API that fills in `id`/`timestamp`/`attempt` and hands
 * a fully-formed envelope to `MessageTransport.publish(envelope)`. Both can
 * appear in stack traces; signature shape (envelope vs payload+meta) makes
 * the layer obvious.
 */
export class MessageBus {
  // Field-init for shared globals (idiomatic MiiaJS pattern).
  private discovery = inject(DiscoveryService)
  private resolver = inject(Resolver)
  // Logger init in constructor body because it depends on busName.
  private logger: Logger
  private subscriptions: Subscription[] = []

  constructor(
    private transport: MessageTransport,
    private idempotencyStore: IdempotencyStore | null,
    private busName: string | null,
    private options: MessageBusOptions = {},
  ) {
    this.logger = new Logger(busName ? `MessageBus:${busName}` : 'MessageBus')
  }

  async onReady(): Promise<void> {
    const allHandlers = this.discovery.getMethodsWithMeta<OnMeta>(ON)

    // Validation: every referenced bus name must point to a registered bus.
    // Each bus instance runs this check; first onReady to fail throws.
    for (const h of allHandlers) {
      const refBus = h.metadata.bus ?? null
      const token = getMessageBusToken(refBus ?? undefined)
      if (!this.resolver.has(token)) {
        throw new Error(
          `[messaging] @On on ${h.ctor.name}.${h.methodName} references bus '${refBus ?? '<default>'}', ` +
            `but no MessagingModule.configure(opts${refBus ? `, '${refBus}'` : ''}) is registered.`,
        )
      }
    }

    // Filter to handlers targeting THIS bus.
    const handlers = allHandlers.filter((h) => (h.metadata.bus ?? null) === this.busName)

    const transportName = (this.transport as object).constructor.name
    const dispatchDefaults = this.options.dispatch ?? null
    const appName = this.options.appName ?? null

    for (const h of handlers) {
      const meta = h.metadata

      // Startup validation: @Idempotent without configured store → fail fast.
      const idemMeta = this.getIdempotentMeta(h.ctor, h.methodName)
      if (idemMeta && !this.idempotencyStore) {
        throw new Error(
          `[messaging] @Idempotent on ${h.ctor.name}.${h.methodName} requires an IdempotencyStore. ` +
            `Pass \`idempotency: memoryIdempotencyStore()\` (dev) or ` +
            `\`idempotency: redisIdempotencyStore({...})\` (prod) to MessagingModule.configure().`,
        )
      }

      // broadcast and explicit group are conceptually opposite intents.
      if (meta.broadcast && meta.group) {
        throw new Error(
          `[messaging] @On on ${h.ctor.name}.${h.methodName}: broadcast and group are mutually exclusive. ` +
            `Use broadcast for cluster-wide fan-out, or group for an explicit competing-consumers pool, not both.`,
        )
      }

      // @Idempotent default key is `${envelope.id}:${ctor}.${method}` - shared
      // across replicas. With broadcast, every replica receives a copy; the
      // first replica claims the key and the rest see a stale claim → silent
      // skip → broadcast effectively becomes "first wins". Reject at startup
      // unless the user provided an explicit key callback (presumably scoped
      // per-process).
      if (meta.broadcast && idemMeta && !idemMeta.key) {
        throw new Error(
          `[messaging] @On on ${h.ctor.name}.${h.methodName} combines broadcast: true with @Idempotent ` +
            `using the default key, but the default key is shared across replicas - the first replica to ` +
            `claim it would silently skip the handler on every other replica, breaking broadcast semantics. ` +
            `Either remove @Idempotent (broadcast usually targets non-idempotent local state like cache invalidation) ` +
            `or provide an explicit \`key\` callback that scopes the claim per replica.`,
        )
      }

      // Explicit broker group requires the transport to support
      // competing-consumers semantic (broker round-robin within a group).
      if (meta.group && !this.transport.supportsCompetingConsumers) {
        throw new Error(
          `[messaging] @On on ${h.ctor.name}.${h.methodName} on bus '${this.busName ?? '<default>'}' ` +
            `declares explicit group '${meta.group}', but transport ${transportName} does not support ` +
            `competing consumers. Either remove the group option (use the auto-derived per-handler group) ` +
            `or use a transport with broker-side consumer groups (e.g. RedisStreamsTransport).`,
        )
      }

      const effectiveMode: DispatchMode = meta.mode ?? dispatchDefaults?.mode ?? this.transport.defaultMode
      const effectiveConcurrency: number = meta.concurrency ?? dispatchDefaults?.concurrency ?? 1

      if (!this.transport.supportedModes.includes(effectiveMode)) {
        const supported = this.transport.supportedModes.map((m) => `'${m}'`).join(', ')
        throw new Error(
          `[messaging] @On on ${h.ctor.name}.${h.methodName} on bus '${this.busName ?? '<default>'}' ` +
            `for topic '${meta.topic}' requests dispatch mode '${effectiveMode}' which is not supported by ` +
            `${transportName}. Supported modes: [${supported}].`,
        )
      }

      if (effectiveConcurrency <= 0 || !Number.isFinite(effectiveConcurrency)) {
        throw new Error(
          `[messaging] @On on ${h.ctor.name}.${h.methodName} for topic '${meta.topic}' resolves to ` +
            `concurrency=${effectiveConcurrency}, which is invalid. Concurrency must be a positive integer ` +
            `(minimum 1).`,
        )
      }

      const group = deriveGroupName({
        topic: meta.topic,
        ctorName: h.ctor.name,
        methodName: h.methodName,
        appName,
        explicitGroup: meta.group,
        broadcast: meta.broadcast,
      })

      const sub = await this.transport.subscribe(meta.topic, async (envelope) => this.dispatch(h, envelope), {
        group,
        concurrency: effectiveConcurrency,
        mode: effectiveMode,
        broadcast: meta.broadcast,
      })
      this.subscriptions.push(sub)
    }
  }

  private getIdempotentMeta(ctor: Constructor, methodName: string): IdempotentMeta | undefined {
    const map = getMeta<Map<string, IdempotentMeta>>(ctor, IDEMPOTENT)
    return map?.get(methodName)
  }

  /**
   * Publish a message. Meta fields are optional and additive - the framework
   * fills in `id`, `timestamp`, and `attempt`. Composes onto
   * `MessageTransport.publish(envelope)` internally.
   *
   * For distributed tracing, populate `traceparent` (and optionally `tracestate`)
   * from your tracing library so consumers can continue the trace.
   *
   * @example
   * ```ts
   * import { trace } from '@opentelemetry/api'
   *
   * const span = trace.getActiveSpan()
   * const ctx = span?.spanContext()
   * await bus.publish('order.placed', order, {
   *   traceparent: ctx
   *     ? `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags.toString(16).padStart(2, '0')}`
   *     : undefined,
   * })
   * ```
   */
  async publish<T>(
    topic: string,
    payload: T,
    meta?: Partial<Pick<MessageMeta, 'correlationId' | 'causationId' | 'traceparent' | 'tracestate'>>,
  ): Promise<void> {
    const envelope: MessageEnvelope<T> = {
      id: randomUUID(),
      topic,
      payload,
      meta: {
        timestamp: Date.now(),
        attempt: 1,
        ...meta,
      },
    }
    await this.transport.publish(envelope)
  }

  async onDestroy(): Promise<void> {
    for (const sub of this.subscriptions) {
      await sub.unsubscribe()
    }
    this.subscriptions = []
  }

  private async dispatch(
    h: ReturnType<DiscoveryService['getMethodsWithMeta']>[number],
    envelope: MessageEnvelope,
  ): Promise<HandlerResult> {
    const callHandler = () =>
      (h.instance as Record<string, (...args: unknown[]) => unknown>)[h.methodName]!(envelope.payload, envelope.meta)

    const idemMeta = this.getIdempotentMeta(h.ctor, h.methodName)

    if (!idemMeta) {
      try {
        await callHandler()
        return { status: 'ack' }
      } catch (err) {
        this.logger.error(
          `Handler ${h.ctor.name}.${h.methodName} failed for ${envelope.topic} (attempt ${envelope.meta.attempt})`,
          err instanceof Error ? (err.stack ?? err.message) : String(err),
        )
        return { status: 'nack', error: err instanceof Error ? err : new Error(String(err)) }
      }
    }

    // @Idempotent path: claim → run → release on failure.
    // Per-handler default key avoids cross-handler conflicts; user can override
    // via `key` to widen scope (e.g. share across handlers).
    const id = idemMeta.key?.(envelope.payload, envelope.meta) ?? `${envelope.id}:${h.ctor.name}.${h.methodName}`
    const claimed = await this.idempotencyStore!.claim(id, idemMeta.ttl)
    if (!claimed) return { status: 'ack' } // already processed - silently skip

    try {
      await callHandler()
      return { status: 'ack' }
    } catch (err) {
      // Release so a retry can re-claim and re-process. Failure to release
      // is logged but does not mask the original handler error.
      await this.idempotencyStore!.release(id).catch((releaseErr) => {
        this.logger.error(`Failed to release idempotency claim ${id}`, String(releaseErr))
      })
      this.logger.error(
        `Handler ${h.ctor.name}.${h.methodName} failed for ${envelope.topic} (attempt ${envelope.meta.attempt})`,
        err instanceof Error ? (err.stack ?? err.message) : String(err),
      )
      return { status: 'nack', error: err instanceof Error ? err : new Error(String(err)) }
    }
  }
}
