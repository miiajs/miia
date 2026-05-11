import { Logger } from '@miiajs/core'
import { dlqTopic, nextBackoffMs } from './retry.js'
import {
  DEFAULT_RETRY,
  type DispatchMode,
  type MessageEnvelope,
  type MessageTransport,
  type HandlerResult,
  type RetryConfig,
  type SubscribeOptions,
  type Subscription,
} from './types.js'

export interface InMemoryTransportOptions {
  retry?: Partial<RetryConfig>
  /**
   * When true, payload is `structuredClone`d before each handler sees it.
   * Prevents cross-handler mutation at the cost of one clone per delivery.
   * Default false (same object identity across handlers - consistent with
   * Node EventEmitter semantics).
   */
  cloneOnPublish?: boolean
  /**
   * Max time `onDestroy()` waits for in-flight handlers to settle before
   * forcing cleanup. Default 5000ms. Set 0 to skip drain (immediate cleanup).
   *
   * The drain phase blocks new deliveries (including scheduled retries) and
   * awaits all currently-running handlers. Reaching the timeout logs a warn
   * and continues with cleanup; pending handlers will keep running but their
   * results are discarded.
   */
  drainTimeoutMs?: number
}

interface LocalSub {
  topic: string
  handler: (envelope: MessageEnvelope) => Promise<HandlerResult>
}

const DEFAULT_DRAIN_TIMEOUT_MS = 5000

/**
 * In-process message transport. Fire-and-forget delivery via `queueMicrotask`,
 * exponential backoff retry via `setTimeout`, auto-DLQ via re-publishing to
 * `<topic>.dlq`.
 *
 * NOT persistent. Process crash mid-retry loses pending messages - do not use
 * for durability-sensitive workloads. Use `@miiajs/messaging-redis` or another
 * broker-backed transport in production.
 *
 * **Dispatch capability:** sliding-only, no competing consumers. The in-memory
 * transport is single-process: there is no broker to round-robin messages
 * between multiple handlers in a shared `group`. Auto-derived per-handler
 * groups work normally (each handler is its own subscription, fan-out is
 * automatic). Handlers requesting `mode: 'batch'` or sharing an explicit
 * `group` are rejected at `MessageBus.onReady()`.
 */
export class InMemoryTransport implements MessageTransport {
  readonly supportedModes = ['sliding'] as const satisfies readonly DispatchMode[]
  readonly defaultMode: DispatchMode = 'sliding'
  readonly supportsCompetingConsumers = false

  private subs = new Map<string, LocalSub[]>()
  private retry: RetryConfig
  private cloneOnPublish: boolean
  private drainTimeoutMs: number
  private logger = new Logger('InMemoryTransport')
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>()
  private pendingDeliveries = new Set<Promise<void>>()
  private destroying = false

  constructor(options: InMemoryTransportOptions = {}) {
    this.retry = { ...DEFAULT_RETRY, ...options.retry }
    this.cloneOnPublish = options.cloneOnPublish ?? false
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS
  }

  async publish(envelope: MessageEnvelope): Promise<void> {
    const subs = this.subs.get(envelope.topic)
    if (!subs || subs.length === 0) return
    // Fire-and-forget: resolve immediately, handlers run in microtask.
    queueMicrotask(() => {
      for (const sub of subs) {
        this.deliver(sub, envelope)
      }
    })
  }

  async subscribe(
    topic: string,
    handler: (envelope: MessageEnvelope) => Promise<HandlerResult>,
    _options: SubscribeOptions,
  ): Promise<Subscription> {
    // SubscribeOptions.group and .concurrency are meaningless in a single
    // process - local fan-out always delivers to every subscriber.
    const sub: LocalSub = { topic, handler }
    const list = this.subs.get(topic) ?? []
    list.push(sub)
    this.subs.set(topic, list)

    return {
      unsubscribe: async () => {
        const list = this.subs.get(topic)
        if (!list) return
        const idx = list.indexOf(sub)
        if (idx >= 0) list.splice(idx, 1)
        if (list.length === 0) this.subs.delete(topic)
      },
    }
  }

  async onDestroy(): Promise<void> {
    this.destroying = true
    await this.waitForDrain()
    for (const timer of this.pendingTimers) clearTimeout(timer)
    this.pendingTimers.clear()
    this.subs.clear()
  }

  /** Tracking wrapper - every (initial and retry) delivery flows through here. */
  private deliver(sub: LocalSub, envelope: MessageEnvelope): void {
    if (this.destroying) return // refuse new work during shutdown

    const promise = this.runDelivery(sub, envelope)
    this.pendingDeliveries.add(promise)
    promise.finally(() => this.pendingDeliveries.delete(promise))
  }

  private async runDelivery(sub: LocalSub, envelope: MessageEnvelope): Promise<void> {
    const delivered = this.cloneOnPublish ? { ...envelope, payload: structuredClone(envelope.payload) } : envelope

    let result: HandlerResult
    try {
      result = await sub.handler(delivered)
    } catch (err) {
      result = { status: 'nack', error: err instanceof Error ? err : new Error(String(err)) }
    }

    if (result.status === 'ack') return

    // Nack: retry or DLQ.
    if (envelope.meta.attempt < this.retry.maxAttempts) {
      const delay = nextBackoffMs(envelope.meta.attempt, this.retry)
      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer)
        // Retry routes back through deliver() so it's tracked in pendingDeliveries.
        this.deliver(sub, {
          ...envelope,
          meta: { ...envelope.meta, attempt: envelope.meta.attempt + 1 },
        })
      }, delay)
      this.pendingTimers.add(timer)
      return
    }

    // Final failure.
    this.logger.error(
      `Message ${envelope.id} on ${envelope.topic} exhausted ${this.retry.maxAttempts} attempts`,
      result.error.stack ?? result.error.message,
    )
    if (this.retry.dlq) {
      await this.publish({
        ...envelope,
        topic: dlqTopic(envelope.topic),
        meta: { ...envelope.meta, lastError: result.error.message },
      })
    }
  }

  private async waitForDrain(): Promise<void> {
    if (this.drainTimeoutMs <= 0 || this.pendingDeliveries.size === 0) return

    const drainPromise = Promise.allSettled([...this.pendingDeliveries])
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<'timeout'>((r) => {
      timer = setTimeout(() => r('timeout'), this.drainTimeoutMs)
    })

    try {
      const result = await Promise.race([drainPromise.then(() => 'drained' as const), timeoutPromise])
      if (result === 'timeout') {
        this.logger.warn(`Drain timeout: ${this.pendingDeliveries.size} handler(s) still in flight`)
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

export function inMemoryTransport(options: InMemoryTransportOptions = {}): MessageTransport {
  return new InMemoryTransport(options)
}
