import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { Logger } from '@miiajs/core'
import {
  DEFAULT_RETRY,
  type DispatchMode,
  dlqTopic,
  type MessageEnvelope,
  type MessageTransport,
  type HandlerResult,
  nextBackoffMs,
  type RetryConfig,
  type SubscribeOptions,
  type Subscription,
} from '@miiajs/messaging'
import { Redis } from 'ioredis'
import { DLQ_SCRIPT, DRAIN_RETRY_SCRIPT, RETRY_SCHEDULE_SCRIPT } from './retry-queue.js'
import { parseEnvelopeFromFields } from './serialization.js'

export interface RedisStreamsTransportOptions {
  /** Redis URL (e.g. `redis://localhost:6379`). Mutually exclusive with `client`. */
  url?: string
  /** Pre-built ioredis instance. Takes precedence over `url`. */
  client?: Redis
  retry?: Partial<RetryConfig>
  /** How often to drain the retry ZSET back into the main stream. Default 1000ms. */
  retrySchedulerIntervalMs?: number
  /** How often to XAUTOCLAIM stale pending entries. Default 30000ms. */
  reclaimIntervalMs?: number
  /** Minimum idle time (ms) before an entry is eligible for XAUTOCLAIM. Default 60000. */
  minIdleMs?: number
  /** Overrides the auto-generated consumer name (`hostname:pid:rand8`). */
  consumerName?: string
  /**
   * XREADGROUP BLOCK timeout in ms. Default 5000.
   *
   * Each `subscribe()` call owns its own duplicated Redis connection (see
   * connection model on the class), so this knob does NOT affect publish or
   * read latency for new messages - those wake the blocked subscriber as soon
   * as data lands. It only governs:
   *   - Idle Redis traffic: one `XREADGROUP` per subscription per `blockMs`
   *     when the stream is empty.
   *   - Recovery cadence after transient errors (the loop falls back through
   *     a 1s sleep + a fresh BLOCK on the next iteration).
   *
   * Shutdown responsiveness is decoupled - `onDestroy()` / `unsubscribe()`
   * call `disconnect()` on the subClient, which forces the in-flight BLOCK
   * to throw and the loop to exit immediately regardless of `blockMs`.
   */
  blockMs?: number
  /**
   * Max time `onDestroy()` waits for in-flight handlers to settle before
   * forcing cleanup. Default 5000ms. Set 0 to skip drain (immediate quit).
   *
   * Drain happens after subClients are disconnected but before the pubClient
   * closes, so handlers can still complete `xack` / Lua calls through the
   * pubClient. A timed-out handler will leak and may trigger redelivery via
   * XAUTOCLAIM after `minIdleMs`. Size `drainTimeoutMs` to cover expected
   * handler runtime; it no longer needs to absorb `blockMs`.
   */
  drainTimeoutMs?: number
}

/**
 * One blocking `XREADGROUP` lane. Each lane owns a dedicated duplicated
 * client created via `pubClient.duplicate({ lazyConnect: true })`. Owned by
 * the transport regardless of `ownsClient` - subClients are always our
 * responsibility to close on unsubscribe / destroy.
 *
 * Batch-mode subscriptions have exactly one lane; sliding-mode subscriptions
 * have `concurrency` lanes, each running `XREADGROUP COUNT 1` in parallel.
 */
interface SubLane {
  client: Redis
  consumer: string
}

interface ActiveSub {
  topic: string
  group: string
  mode: DispatchMode
  concurrency: number
  /**
   * True if the group name encodes per-process suffix (`@On({ broadcast: true })`).
   * Triggers orphan cleanup on subscribe (cross-restart recovery) and XGROUP DESTROY
   * on shutdown so per-process groups don't leak in Redis state.
   */
  isBroadcast: boolean
  handler: (envelope: MessageEnvelope) => Promise<HandlerResult>
  abort: AbortController
  lanes: SubLane[]
}

type StreamReadResult = Array<[string, Array<[string, string[]]>]>

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Signatures for the Lua commands registered via ioredis defineCommand().
// TS doesn't learn those dynamically, so we keep them as a narrow cast target.
interface LuaCommands {
  retrySchedule(
    streamKey: string,
    retryKey: string,
    group: string,
    entryId: string,
    retryAtMs: number,
    envelopeJson: string,
  ): Promise<number>
  drainRetry(streamKey: string, retryKey: string, nowMs: number, batchSize: number): Promise<number>
  moveToDlq(streamKey: string, dlqKey: string, group: string, entryId: string, envelopeJson: string): Promise<number>
}

/**
 * Redis Streams transport for `@miiajs/messaging`.
 *
 * Semantics:
 * - `publish()` → `XADD <topic> * data <envelope JSON>`
 * - `subscribe()` creates/joins a consumer group, spawns a loop that reads
 *   with `XREADGROUP ... BLOCK 5000 ... COUNT <concurrency>`
 * - On nack:
 *     - If `attempt < maxAttempts`: atomic ack + ZADD to `${topic}:retry`
 *       with score = `now + nextBackoffMs()`. A background scheduler drains
 *       due entries back into the main stream every `retrySchedulerIntervalMs`.
 *     - Otherwise: atomic ack + XADD to `${topic}.dlq` with `lastError`
 *       recorded in `meta.lastError`.
 * - A separate `reclaimIntervalMs` loop runs `XAUTOCLAIM` on each active
 *   (topic, group) pair to recover messages from dead consumers.
 *
 * Lua scripts are registered via ioredis `defineCommand()` so they execute
 * server-side with SHA caching (EVALSHA fast path).
 *
 * ## Connection model
 *
 * The transport keeps **one publisher client** (`this.client`) that handles
 * `XADD`, `XACK`, all Lua commands, `XGROUP CREATE`, and the `XAUTOCLAIM` /
 * retry-drain housekeeping. Each `subscribe()` call additionally creates its
 * **own duplicated client** via `this.client.duplicate({ lazyConnect: true })`
 * and runs its blocking `XREADGROUP` loop on it.
 *
 * This isolates publishing and Lua-driven retry/DLQ paths from the latency
 * floor of `BLOCK <ms>`: ioredis serializes commands on a single TCP socket,
 * so sharing the publishing client with blocking subscribers would queue
 * every `XADD` behind the in-flight BLOCK. Per-subscribe duplicates make
 * publish latency constant in subscriber count, equal to network RTT.
 *
 * Connection count: `1 (publisher) + Σ handlers × max(1, sliding lane count)`.
 *   - batch handler: +1 connection.
 *   - sliding handler with `concurrency=N`: +N connections.
 *
 * Migration note: prior to handler-per-subscription, multiple `@On` handlers
 * sharing `(topic, group)` were collapsed into one subscription. Now each
 * `@On` is its own subscription, so connection count grows from "one per
 * (topic,group) bucket" to "one per handler × sliding lanes" - trading
 * bandwidth for delivery isolation. A slow/throwing handler no longer blocks
 * or duplicates work for sibling handlers.
 *
 * Cost warning: combining bus-default sliding mode with many handlers is
 * multiplicative. Example: 10 handlers + bus
 * `dispatch: { mode: 'sliding', concurrency: 4 }` = 41 connections per
 * replica (1 publisher + 10 × 4 lanes). On managed Redis (Upstash, Redis
 * Cloud) this can hit tier limits or bump billing. Recommendation: leave
 * bus default at `batch`, opt into `mode: 'sliding'` on individual handlers
 * with variable runtime.
 *
 * Idempotency stores from `@miiajs/messaging-redis` keep their own client
 * and add to the count separately.
 *
 * ## Dispatch modes
 *
 * - `'batch'` (default): single `XREADGROUP COUNT=concurrency` loop on one
 *   duplicated client; current behavior. Best for high-throughput uniform
 *   workloads.
 * - `'sliding'`: spawns `concurrency` parallel lanes, each on its own
 *   duplicated client running `XREADGROUP COUNT 1`. Lane consumer names are
 *   suffixed `:laneN` for diagnosability in `XINFO CONSUMERS`. Best when
 *   handler runtimes vary (no head-of-line blocking).
 *
 * ## Broadcast group lifecycle
 *
 * Handlers with `broadcast: true` derive their consumer group as
 * `<base>__<hostname>_<pid>`. On graceful shutdown (`onDestroy`), the
 * transport runs `XGROUP DESTROY` on those groups so they don't leak.
 * For ungraceful exits (process crash), the next process to subscribe
 * with broadcast on the same hostname scans `XINFO GROUPS` and destroys
 * any matching `<base>__<thishost>_<otherpid>` groups - cleanup happens
 * automatically on first restart.
 *
 * SubClients are owned by the transport regardless of `ownsClient` - the
 * `ownsClient` flag only controls the lifecycle of the user-supplied parent.
 * Duplicates are always created and closed by us.
 *
 * Lua commands are registered per-instance in ioredis (via `defineCommand`).
 * SubClients do NOT inherit that registration, which is fine: subClients
 * only run `XREADGROUP`, never Lua.
 */
export class RedisStreamsTransport implements MessageTransport {
  readonly supportedModes = ['batch', 'sliding'] as const satisfies readonly DispatchMode[]
  readonly defaultMode: DispatchMode = 'batch'
  readonly supportsCompetingConsumers = true

  private client: Redis
  /** True if the transport owns the client lifecycle (connect/quit). */
  private ownsClient: boolean
  private retry: RetryConfig
  private subs: ActiveSub[] = []
  private schedulerTimer?: ReturnType<typeof setInterval>
  private reclaimTimer?: ReturnType<typeof setInterval>
  private logger = new Logger('RedisStreamsTransport')
  private readonly consumerName: string
  private readonly retrySchedulerIntervalMs: number
  private readonly reclaimIntervalMs: number
  private readonly minIdleMs: number
  private readonly blockMs: number
  private readonly drainTimeoutMs: number
  private pendingDeliveries = new Set<Promise<void>>()

  constructor(options: RedisStreamsTransportOptions) {
    if (!options.client && !options.url) {
      throw new Error('[messaging-redis] Either `url` or `client` must be provided')
    }
    if (options.client) {
      this.client = options.client
      this.ownsClient = false
    } else {
      this.client = new Redis(options.url!, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
      })
      this.ownsClient = true
    }
    this.retry = { ...DEFAULT_RETRY, ...options.retry }
    this.consumerName = options.consumerName ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
    this.retrySchedulerIntervalMs = options.retrySchedulerIntervalMs ?? 1000
    this.reclaimIntervalMs = options.reclaimIntervalMs ?? 30000
    this.minIdleMs = options.minIdleMs ?? 60000
    this.blockMs = options.blockMs ?? 5000
    this.drainTimeoutMs = options.drainTimeoutMs ?? 5000

    this.registerLuaCommands()
  }

  private registerLuaCommands(): void {
    // defineCommand is dynamic - each call adds a method on the client instance.
    // TypeScript types in ioredis don't cover dynamic commands, so cast.
    const c = this.client as unknown as {
      defineCommand: (name: string, options: { numberOfKeys: number; lua: string }) => void
    }
    c.defineCommand('retrySchedule', { numberOfKeys: 2, lua: RETRY_SCHEDULE_SCRIPT })
    c.defineCommand('drainRetry', { numberOfKeys: 2, lua: DRAIN_RETRY_SCRIPT })
    c.defineCommand('moveToDlq', { numberOfKeys: 2, lua: DLQ_SCRIPT })
  }

  private get lua(): LuaCommands {
    return this.client as unknown as LuaCommands
  }

  async onInit(): Promise<void> {
    // Only manage connection state when the transport constructed the client.
    // If the user provided a pre-built Redis instance, their code owns its
    // lifecycle - we don't call connect() or quit() on it.
    if (this.ownsClient && this.client.status !== 'ready') {
      await this.client.connect()
    }
    this.schedulerTimer = setInterval(() => {
      this.drainRetryZset().catch((err) => this.logger.error('retry drain failed', String(err)))
    }, this.retrySchedulerIntervalMs)
    this.reclaimTimer = setInterval(() => {
      this.reclaimIdle().catch((err) => this.logger.error('idle reclaim failed', String(err)))
    }, this.reclaimIntervalMs)
  }

  async onDestroy(): Promise<void> {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer)
    if (this.reclaimTimer) clearInterval(this.reclaimTimer)

    // Snapshot before clearing - we still need each sub's lane clients below
    // to tear their blocking sockets. Order:
    //   1. abort first so the catch in runConsumerLoop sees aborted=true
    //   2. disconnect each lane to actually break the BLOCK
    //   3. drain in-flight handlers (their XACK / Lua calls go through the
    //      still-alive pubClient on existing groups)
    //   4. XGROUP DESTROY for broadcast subs (after drain to avoid NOGROUP
    //      on pending acks; before pubClient.quit because DESTROY uses it)
    //   5. quit pubClient
    const subsSnapshot = this.subs
    this.subs = []
    for (const sub of subsSnapshot) sub.abort.abort()
    for (const sub of subsSnapshot) for (const lane of sub.lanes) lane.client.disconnect()

    await this.waitForDrain()

    for (const sub of subsSnapshot) {
      if (!sub.isBroadcast) continue
      await this.client
        .xgroup('DESTROY', sub.topic, sub.group)
        .catch((err) => this.logger.warn(`xgroup destroy failed for ${sub.group} on ${sub.topic}: ${String(err)}`))
    }

    if (this.ownsClient && this.client.status !== 'end') {
      await this.client.quit().catch(() => {
        /* swallow quit errors - connection already closing */
      })
    }
  }

  /**
   * Destroy orphaned broadcast groups from previous incarnations of this
   * process on the same host. Called from `subscribe()` when subscribing
   * with a broadcast group, before XGROUP CREATE.
   *
   * Matching strategy: anchor by current `hostname()` and `process.pid` to
   * derive the suffix slice deterministically. Hostnames may contain
   * underscores (e.g. `node_worker_3`, `pod_abc_xyz_42`); a greedy regex
   * split would mis-segment them and risk destroying unrelated groups.
   */
  private async cleanupBroadcastOrphans(topic: string, currentGroup: string): Promise<void> {
    const host = hostname()
    const myPid = String(process.pid)
    const suffix = `__${host}_${myPid}`
    if (!currentGroup.endsWith(suffix)) {
      // Defensive: currentGroup wasn't formed by our broadcast derivation,
      // skip cleanup rather than guess.
      return
    }
    const prefix = currentGroup.slice(0, -suffix.length)
    const orphanPattern = new RegExp(`^${escapeRegex(prefix)}__${escapeRegex(host)}_(\\d+)$`)

    let groups: Array<[string, ...unknown[]]>
    try {
      groups = (await (this.client as unknown as { xinfo: (...args: unknown[]) => Promise<unknown> }).xinfo(
        'GROUPS',
        topic,
      )) as Array<[string, ...unknown[]]>
    } catch (err) {
      // NOGROUP / ENOENT - stream/groups don't exist yet, nothing to clean.
      const msg = String(err)
      if (msg.includes('NOGROUP') || msg.includes('no such key')) return
      this.logger.warn(`xinfo GROUPS failed for ${topic}: ${msg}`)
      return
    }

    for (const groupInfo of groups) {
      // groupInfo format: ['name', '<groupname>', 'consumers', N, ...]
      const groupName = String(groupInfo[1])
      if (groupName === currentGroup) continue
      if (!orphanPattern.test(groupName)) continue
      // Same hostname, different pid → orphaned by previous incarnation.
      await this.client
        .xgroup('DESTROY', topic, groupName)
        .catch((err) => this.logger.warn(`orphan cleanup failed for ${groupName}: ${String(err)}`))
      this.logger.log(`Cleaned up orphaned broadcast group ${groupName} on ${topic}`)
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

  async publish(envelope: MessageEnvelope): Promise<void> {
    await this.client.xadd(envelope.topic, '*', 'data', JSON.stringify(envelope))
  }

  async subscribe(
    topic: string,
    handler: (envelope: MessageEnvelope) => Promise<HandlerResult>,
    options: SubscribeOptions,
  ): Promise<Subscription> {
    const group = options.group ?? 'default'
    const concurrency = options.concurrency ?? 1
    // Defensive default - the bus normally resolves and validates `mode`
    // upstream, but direct callers (or transports under test) may omit it.
    const mode: DispatchMode = options.mode ?? this.defaultMode
    const isBroadcast = options.broadcast === true

    // Broadcast handlers derive group as `<base>__<host>_<pid>`. Each restart
    // of the process produces a new group (different pid), and the previous
    // incarnation's group is left orphaned in Redis. Scan and destroy
    // matching groups from prior pids on the same host before we create the
    // current one.
    if (isBroadcast) {
      await this.cleanupBroadcastOrphans(topic, group)
    }

    // Idempotent group creation - MKSTREAM auto-creates the stream if missing.
    try {
      await this.client.xgroup('CREATE', topic, group, '$', 'MKSTREAM')
    } catch (err) {
      if (!String(err).includes('BUSYGROUP')) throw err
    }

    // Lane fan-out:
    //   batch  - 1 lane that reads `XREADGROUP COUNT=concurrency` (current
    //            behavior; head-of-line within a batch).
    //   sliding - `concurrency` lanes, each `COUNT=1`. Each lane gets its own
    //            duplicated client and a unique `:laneN` consumer name so
    //            Redis distributes pending entries across them naturally.
    const laneCount = mode === 'sliding' ? concurrency : 1
    const perLaneCount = mode === 'sliding' ? 1 : concurrency

    const lanes: SubLane[] = []
    try {
      for (let i = 0; i < laneCount; i++) {
        const consumer = mode === 'sliding' ? `${this.consumerName}:lane${i}` : this.consumerName
        // lazyConnect override: we control connect lifecycle even when the
        // parent was eagerly connected (typical for user-supplied `client`).
        const client = this.client.duplicate({ lazyConnect: true })
        await client.connect()
        lanes.push({ client, consumer })
      }
    } catch (err) {
      // Mid-spawn failure: tear down already-connected lanes before bubbling.
      for (const lane of lanes) lane.client.disconnect()
      throw err
    }

    const abort = new AbortController()
    const sub: ActiveSub = { topic, group, mode, concurrency, isBroadcast, handler, abort, lanes }
    this.subs.push(sub)
    // Fire and forget per lane - each runs until aborted.
    for (const [i, lane] of lanes.entries()) {
      this.runConsumerLoop(sub, lane, perLaneCount, i).catch((err) => {
        this.logger.error(`Consumer loop ${topic} lane ${i} terminated`, String(err))
      })
    }

    return {
      unsubscribe: async () => {
        abort.abort()
        const idx = this.subs.indexOf(sub)
        if (idx >= 0) this.subs.splice(idx, 1)
        // disconnect() is sync in ioredis 5; tears the socket so each lane's
        // in-flight BLOCK rejects with "Connection is closed" and the loop
        // exits via the existing aborted branch.
        for (const lane of sub.lanes) lane.client.disconnect()
      },
    }
  }

  private async runConsumerLoop(sub: ActiveSub, lane: SubLane, perLaneCount: number, laneIndex: number): Promise<void> {
    while (!sub.abort.signal.aborted) {
      try {
        // XREADGROUP runs on the per-lane client so it cannot block
        // publishes / Lua / XACK on the shared pubClient.
        const result = (await lane.client.xreadgroup(
          'GROUP',
          sub.group,
          lane.consumer,
          'COUNT',
          perLaneCount,
          'BLOCK',
          this.blockMs,
          'STREAMS',
          sub.topic,
          '>',
        )) as StreamReadResult | null

        if (!result || sub.abort.signal.aborted) continue

        const messages = result[0]?.[1] ?? []
        // In sliding mode `messages.length` is at most 1, so the inner
        // allSettled is degenerate; in batch mode it's the head-of-line
        // barrier we explicitly opt into.
        await Promise.allSettled(
          messages.map((msg) => {
            const p = this.processMessage(sub, msg)
            this.pendingDeliveries.add(p)
            p.finally(() => this.pendingDeliveries.delete(p))
            return p
          }),
        )
      } catch (err) {
        if (sub.abort.signal.aborted) break

        // NOGROUP means the stream or consumer group was deleted externally
        // (e.g. during test cleanup or operator intervention). Treat as a
        // graceful shutdown of this lane - retrying would just spam errors
        // against a non-existent group.
        if (String(err).includes('NOGROUP')) {
          this.logger.warn(`Stream/group gone for ${sub.topic} lane ${laneIndex}, exiting consumer loop`)
          break
        }

        this.logger.error(`Consumer loop error for ${sub.topic} lane ${laneIndex}`, String(err))
        // Abortable sleep - so tests that tear down during backoff don't
        // wait the full 1000ms before the loop exits.
        await this.abortableSleep(1000, sub.abort.signal)
      }
    }
  }

  private abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve()
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private async processMessage(sub: ActiveSub, [id, fields]: [string, string[]]): Promise<void> {
    let envelope: MessageEnvelope
    try {
      envelope = parseEnvelopeFromFields(fields)
    } catch (err) {
      this.logger.error(`Failed to parse stream entry ${id}`, String(err))
      // Drop unparseable entries - no point retrying corrupt data.
      await this.client.xack(sub.topic, sub.group, id)
      return
    }

    let result: HandlerResult
    try {
      result = await sub.handler(envelope)
    } catch (err) {
      result = {
        status: 'nack',
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }

    if (result.status === 'ack') {
      await this.client.xack(sub.topic, sub.group, id)
      return
    }

    await this.handleNack(sub, id, envelope, result.error)
  }

  private async handleNack(sub: ActiveSub, id: string, envelope: MessageEnvelope, error: Error): Promise<void> {
    const nextAttempt = envelope.meta.attempt + 1

    if (nextAttempt > this.retry.maxAttempts) {
      if (this.retry.dlq) {
        const dlqEnvelope = JSON.stringify({
          ...envelope,
          topic: dlqTopic(sub.topic),
          meta: { ...envelope.meta, lastError: error.message },
        })
        await this.lua.moveToDlq(sub.topic, dlqTopic(sub.topic), sub.group, id, dlqEnvelope)
      } else {
        await this.client.xack(sub.topic, sub.group, id)
        this.logger.error(
          `Dropped ${envelope.id} on ${sub.topic} after ${this.retry.maxAttempts} attempts`,
          error.stack ?? error.message,
        )
      }
      return
    }

    const delay = nextBackoffMs(envelope.meta.attempt, this.retry)
    const retryAt = Date.now() + delay
    const retryEnvelope = JSON.stringify({
      ...envelope,
      meta: { ...envelope.meta, attempt: nextAttempt },
    })
    await this.lua.retrySchedule(sub.topic, `${sub.topic}:retry`, sub.group, id, retryAt, retryEnvelope)
  }

  private async drainRetryZset(): Promise<void> {
    const topics = new Set(this.subs.map((s) => s.topic))
    const now = Date.now()
    for (const topic of topics) {
      await this.lua.drainRetry(topic, `${topic}:retry`, now, 100)
    }
  }

  private async reclaimIdle(): Promise<void> {
    // Multiple subs may share the same (topic, group) when explicit `group`
    // puts handler classes into a competing-consumers pool. Dedupe here so
    // we issue one XAUTOCLAIM per (topic, group) rather than one per handler.
    const seen = new Set<string>()
    for (const sub of this.subs) {
      const key = `${sub.topic}::${sub.group}`
      if (seen.has(key)) continue
      seen.add(key)
      try {
        // Some ioredis type versions may lack typed xautoclaim signatures.
        // The consumer arg is a label on PEL ownership; we use lane[0] as a
        // stable target. XAUTOCLAIM operates at the group level, so one call
        // per (topic, group) suffices regardless of lane count.
        await (this.client as unknown as { xautoclaim: (...args: unknown[]) => Promise<unknown> }).xautoclaim(
          sub.topic,
          sub.group,
          sub.lanes[0]!.consumer,
          this.minIdleMs,
          '0',
          'COUNT',
          100,
        )
      } catch (err) {
        this.logger.warn(`xautoclaim failed for ${sub.topic} group ${sub.group}: ${String(err)}`)
      }
    }
  }
}

export function redisStreamsTransport(options: RedisStreamsTransportOptions): MessageTransport {
  return new RedisStreamsTransport(options)
}
