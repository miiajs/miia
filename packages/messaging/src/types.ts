/**
 * Full envelope shape that transports publish and deliver. All fields
 * except `payload` are framework-managed. User code only sees `payload`
 * (and optionally `meta`) inside `@On` handlers.
 */
export interface MessageEnvelope<T = unknown> {
  id: string
  topic: string
  payload: T
  meta: MessageMeta
}

export interface MessageMeta {
  /** Epoch milliseconds at first publish. Does not change on retry. */
  timestamp: number
  /** 1 on first delivery, incremented by the transport on each retry. */
  attempt: number
  correlationId?: string
  causationId?: string
  /**
   * W3C Trace Context traceparent header value.
   * Format: `00-<traceId>-<spanId>-<flags>` (e.g. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`).
   *
   * Populate at publish time from your tracing library (OpenTelemetry, Datadog,
   * Sentry, etc.). Consumers can restore span context to continue the
   * distributed trace across service boundaries.
   *
   * Pass `undefined` to skip; do not pass an empty string (it would serialize
   * as a truthy-looking invalid value on the consumer side).
   *
   * @see https://www.w3.org/TR/trace-context/#traceparent-header
   */
  traceparent?: string
  /**
   * W3C Trace Context tracestate header. Vendor-specific key/value pairs that
   * accompany `traceparent`.
   *
   * @see https://www.w3.org/TR/trace-context/#tracestate-header
   */
  tracestate?: string
  /** Populated only when the envelope is moved to the DLQ. */
  lastError?: string
}

/**
 * Dispatch behavior for a subscription's message-pump loop.
 *
 * - `'batch'` - read up to `concurrency` messages, run them through
 *   `Promise.allSettled`, then read again. The slowest handler in the batch
 *   blocks the next read (head-of-line). Best for high-throughput uniform
 *   workloads with negligible per-message variance.
 * - `'sliding'` - each in-flight message progresses independently; the
 *   subscription pulls the next message as soon as a slot frees, without
 *   waiting for the rest of the batch. Best when handler runtimes vary.
 *
 * Each transport declares its `supportedModes` and `defaultMode`; the bus
 * validates handler-requested modes against that capability set on startup.
 */
export type DispatchMode = 'batch' | 'sliding'

export interface SubscribeOptions {
  /**
   * Consumer group for load-balancing between replicas/processes.
   * Identical `group` across replicas = broker delivers each message to
   * exactly one replica in the group. Different groups = fan-out (every
   * group gets a copy). In-memory transport ignores this - within a single
   * process local fan-out always runs every matching handler.
   */
  group?: string

  /**
   * Prefetch-style: how many messages the transport may pull / process
   * in parallel within one subscription. Redis Streams: XREADGROUP COUNT
   * (batch) or number of sliding lanes. RabbitMQ: basic.qos prefetch.
   * NATS: max_in_flight. Ignored by in-memory.
   */
  concurrency?: number

  /**
   * Resolved effective dispatch mode for this subscription. The bus
   * resolves this from `@On({ mode })` > bus default > `transport.defaultMode`
   * and validates against `transport.supportedModes` before calling
   * `subscribe()`. Transports may assume the value is in `supportedModes`.
   */
  mode?: DispatchMode

  /**
   * Marker that the group name encodes a per-process suffix (`@On({ broadcast: true })`).
   * Transports that maintain stateful broker-side groups (Redis Streams, Kafka)
   * use this flag to clean up orphaned groups from previous process incarnations
   * on subscribe and to destroy the current group on shutdown. Transports
   * without broker state (in-memory) ignore it.
   */
  broadcast?: boolean
}

export type HandlerResult = { status: 'ack' } | { status: 'nack'; error: Error }

export interface Subscription {
  unsubscribe(): Promise<void>
}

export interface RetryConfig {
  /** Maximum delivery attempts before moving to DLQ (or dropping). Default 5. */
  maxAttempts: number
  /** Base delay in ms for the first retry. Default 1000. */
  backoffMs: number
  /** Exponential multiplier applied per attempt. Default 2 (1s, 2s, 4s, 8s...). */
  backoffMultiplier: number
  /**
   * When true, exhausted messages are published to `<topic>.dlq` with the
   * last error recorded in `meta.lastError`. When false, exhausted messages
   * are acked and logged as errors. Default true.
   */
  dlq: boolean
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 5,
  backoffMs: 1000,
  backoffMultiplier: 2,
  dlq: true,
}

/**
 * Transport contract. Concrete implementations:
 * - `InMemoryTransport` (shipped in this package; default for dev and tests)
 * - `RedisStreamsTransport` from `@miiajs/messaging-redis`
 * - Future: NATS, RabbitMQ, Kafka
 *
 * Retry/DLQ logic lives INSIDE each transport - different brokers have
 * different primitives (Redis ZSET scheduler, RabbitMQ DLX, NATS max_deliver).
 * Handlers simply return ack/nack; transport decides what to do next.
 */
export interface MessageTransport {
  /**
   * Dispatch modes this transport can implement. The bus reads this list to
   * validate handler-requested modes during `MessageBus.onReady()`. Transports
   * declare only modes for which they have a meaningful primitive - emulating
   * a missing primitive (e.g. fake batch on a single-process transport) just
   * adds an artificial barrier without value.
   */
  readonly supportedModes: readonly DispatchMode[]

  /**
   * Mode used when neither the handler nor the bus configuration specifies
   * one. Must be a member of `supportedModes`.
   */
  readonly defaultMode: DispatchMode

  /**
   * Whether the broker supports competing consumers within a single group:
   * a single message is delivered to exactly one consumer in the group
   * (round-robin / load balancing). When `true`, users can pass an explicit
   * `@On({ group: '...' })` to share work between multiple handlers or
   * replicas. When `false`, only fan-out semantics work; bus rejects explicit
   * `group` at startup with a helpful error.
   *
   * Examples:
   * - `true`: Redis Streams, Kafka, RabbitMQ, NATS Core queue groups, JetStream
   * - `false`: InMemoryTransport (single process, no broker), Redis Pub/Sub
   *   (no durable groups)
   */
  readonly supportsCompetingConsumers: boolean

  publish(envelope: MessageEnvelope): Promise<void>

  subscribe(
    topic: string,
    handler: (envelope: MessageEnvelope) => Promise<HandlerResult>,
    options: SubscribeOptions,
  ): Promise<Subscription>

  onInit?(): Promise<void>
  onDestroy?(): Promise<void>
}

/**
 * DI token for the message transport. String token because an abstract class
 * is not type-compatible with core's `Constructor<T>` (abstract `new` vs
 * plain `new`). Matches the `JWT_OPTIONS` pattern in `@miiajs/jwt`.
 *
 * Usage: `private transport = inject<MessageTransport>(MESSAGE_TRANSPORT)`.
 */
export const MESSAGE_TRANSPORT = 'miia:messaging:transport'
