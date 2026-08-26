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
import {
  CONSUMER_ERROR_BACKOFF_MS,
  DEFAULT_BLOCK_MS,
  DEFAULT_DRAIN_TIMEOUT_MS,
  DEFAULT_MIN_IDLE_MS,
  DEFAULT_RETRY_INTERVAL_MS,
  DRAIN_BATCH,
  FAILURE_LOG_BURST,
  FAILURE_LOG_WINDOW_MS,
  HEARTBEAT_BATCH,
  LEGACY_DRAIN_INTERVAL_MS,
  LEGACY_DRAIN_MAX_INTERVAL_MS,
  MAX_HORIZON_MS,
  MIN_HEARTBEAT_INTERVAL_MS,
  PENDING_PAGE,
} from './constants.js'
import { DLQ_SCRIPT, DRAIN_RETRY_SCRIPT, PARK_RETRY_SCRIPT } from './retry-queue.js'
import { parseEnvelopeFromFields } from './serialization.js'

export interface RedisStreamsTransportOptions {
  /** Redis URL (e.g. `redis://localhost:6379`). Mutually exclusive with `client`. */
  url?: string
  /** Pre-built ioredis instance. Takes precedence over `url`. */
  client?: Redis
  retry?: Partial<RetryConfig>
  /** Housekeeping cadence, and so the granularity of backoff timing and crash detection. Default 1000ms. */
  retryIntervalMs?: number
  /** @deprecated Renamed to `retryIntervalMs`. Still honored, below it and above `reclaimIntervalMs`. */
  retrySchedulerIntervalMs?: number
  /** @deprecated Renamed to `retryIntervalMs`. Lowest precedence of the three; its default also dropped 30s -> 1s. */
  reclaimIntervalMs?: number
  /**
   * Floor for the retry horizon, in ms. Default 60000. The horizon is the idle threshold at which a pending entry
   * counts as abandoned, so this is also the crash-detection latency.
   */
  minIdleMs?: number
  /** Overrides the auto-generated consumer name (`hostname:pid:rand8`). */
  consumerName?: string
  /**
   * `XREADGROUP BLOCK` timeout in ms. Default 5000. Governs idle Redis traffic and error-recovery cadence only - new
   * messages wake the blocked read immediately, and shutdown disconnects the socket rather than waiting it out.
   */
  blockMs?: number
  /**
   * Budget `onDestroy()` gives the running housekeeping pass and the in-flight handlers together, before forcing
   * cleanup. Default 5000ms, 0 skips the drain. A timed-out handler's entry stays in the PEL and is redelivered once
   * it crosses the horizon, so this sizes duplicate work, not loss.
   */
  drainTimeoutMs?: number
}

/**
 * One blocking `XREADGROUP` lane on its own duplicated client, always owned by the transport regardless of
 * `ownsClient`. Batch subscriptions get one lane, sliding subscriptions `concurrency` of them.
 */
interface SubLane {
  client: Redis
  consumer: string
}

/** Per-topic schedule of the transitional legacy-ZSET drain. Keyed by topic: the ZSET is `${topic}:retry`. */
interface LegacyDrain {
  /** Live subscriptions on the topic - the schedule stops when the last one unsubscribes. */
  refs: number
  timer?: ReturnType<typeof setTimeout>
  intervalMs: number
  /** The drain currently in flight, if any. Never rejects. */
  running?: Promise<void>
}

/** Failure run of one housekeeping channel: an unbroken streak of failures, and what it has already been let say. */
interface FailureRun {
  /** The cause being suppressed right now. A different one is news, so it earns a line of its own. */
  detail: string
  /** Failures since the run began, whatever the cause - what the recovery line reports. */
  count: number
  /** Failures carrying the current `detail`, so no line ever reports one cause's streak against another. */
  causeCount: number
  /** Start of the current log window: both the periodic line and the burst budget refresh from here. */
  windowStartedAt: number
  /** Lines already emitted in this window, capped at `FAILURE_LOG_BURST`. */
  logsInWindow: number
}

interface ActiveSub {
  topic: string
  group: string
  mode: DispatchMode
  concurrency: number
  /** Group name carries a per-process suffix: triggers orphan cleanup on subscribe and `XGROUP DESTROY` on shutdown. */
  isBroadcast: boolean
  handler: (envelope: MessageEnvelope) => Promise<HandlerResult>
  abort: AbortController
  lanes: SubLane[]
}

type StreamReadResult = Array<[string, Array<[string, string[]]>]>
/** `XPENDING` extended-form row: id, consumer, idle ms, delivery count. */
type PendingEntry = [string, string, number, number]
/** `XCLAIM` reply row. Redis < 7 returns `null` for an entry trimmed while pending. */
type ClaimedEntry = [string, string[]] | null

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Signatures for the Lua commands registered via ioredis defineCommand().
// TS doesn't learn those dynamically, so we keep them as a narrow cast target.
interface LuaCommands {
  parkRetry(streamKey: string, group: string, entryId: string, consumer: string, idleMs: number): Promise<number>
  drainRetry(streamKey: string, retryKey: string, nowMs: number, batchSize: number): Promise<number>
  moveToDlq(streamKey: string, dlqKey: string, group: string, entryId: string, envelopeJson: string): Promise<number>
}

// ioredis 5 types don't cover `XPENDING`'s extended form or variadic ids in
// front of `IDLE` / `JUSTID`, so both go through an untyped view.
interface RawCommands {
  xpending(...args: unknown[]): Promise<unknown>
  xclaim(...args: unknown[]): Promise<unknown>
}

/**
 * Redis Streams transport for `@miiajs/messaging`. `publish()` is `XADD`; `subscribe()` joins a consumer group and
 * reads it with `XREADGROUP ... BLOCK`. Four moving parts:
 *
 * - **The PEL is the retry queue.** A nack acks nothing and re-publishes nothing: the entry stays pending in its own
 *   group and is re-parked with `XCLAIM ... IDLE <horizon - backoff> JUSTID`, so it resurfaces one backoff later and
 *   only for that group. Exhaustion is a gated `XACK` plus an `XADD` to `${topic}.dlq`.
 * - **Housekeeping**, every `retryIntervalMs` per (topic, group): `XPENDING ... IDLE <horizon>`, then claim and
 *   redeliver. A retry whose backoff elapsed and an entry whose consumer died are the same thing here, so crash
 *   recovery needs no branch of its own.
 * - **Heartbeat**, every `horizon / 2`: `XCLAIM ... IDLE 0 JUSTID` over the entries this process is still handling, so
 *   a slow handler does not have to fit inside the horizon. Same stalled-job caveat as BullMQ's `lockRenewTime` - a
 *   handler that blocks the event loop past `horizon / 2` can still lose its entry.
 * - **Connections**: one publisher client for `XADD` / `XACK` / Lua / housekeeping, plus one per lane, so a blocking
 *   `XREADGROUP` never queues a publish behind it.
 *
 * Attempt counter of record is the PEL delivery count, so it survives the process and a SIGKILL mid-handler costs an
 * attempt. Lua scripts run via ioredis `defineCommand()` (EVALSHA fast path). Requires Redis 6.2+ (`XPENDING ... IDLE`,
 * exclusive `(id` cursor).
 *
 * Dispatch modes, connection budgeting, stream retention, and operational caveats:
 * https://miiajs.com/docs/packages/messaging/redis
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
  private retryTimer?: ReturnType<typeof setInterval>
  private heartbeatTimer?: ReturnType<typeof setInterval>
  /** The housekeeping pass currently running, if any - passes never overlap. */
  private retryPass?: Promise<void>
  /** The heartbeat currently in flight, if any. Never rejects. */
  private heartbeatTick?: Promise<void>
  private stopping = false
  private logger = new Logger('RedisStreamsTransport')
  private readonly consumerName: string
  private readonly retryIntervalMs: number
  /** Cadence the legacy drain falls back to while entries are still moving. Never slower than its own base. */
  private readonly legacyDrainFastMs: number
  private readonly minIdleMs: number
  private readonly horizonMs: number
  private readonly heartbeatIntervalMs: number
  private readonly blockMs: number
  private readonly drainTimeoutMs: number
  private pendingDeliveries = new Set<Promise<void>>()
  /**
   * `topic -> group -> entry id -> owning consumer`. Keeps housekeeping off entries we are still handling, and batches
   * the heartbeat per consumer. Nested rather than a composite key because topics and derived group names both
   * contain colons.
   */
  private inFlight = new Map<string, Map<string, Map<string, string>>>()
  /** `topic -> legacy drain schedule`. One per topic, however many groups subscribe to it. */
  private legacyDrains = new Map<string, LegacyDrain>()
  /**
   * `channel -> current failure run`, one entry per unit that can fail on its own: each (topic, group) sweep, the
   * heartbeat, each topic's legacy drain. Only ever read back whole, so the key doubles as the channel's log name.
   */
  private failures = new Map<string, FailureRun>()

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
    this.retryIntervalMs = this.resolveRetryInterval(options)
    this.legacyDrainFastMs = Math.min(this.retryIntervalMs, LEGACY_DRAIN_INTERVAL_MS)
    this.minIdleMs = options.minIdleMs ?? DEFAULT_MIN_IDLE_MS
    this.horizonMs = this.resolveHorizon()
    this.heartbeatIntervalMs = Math.max(MIN_HEARTBEAT_INTERVAL_MS, Math.floor(this.horizonMs / 2))
    this.blockMs = options.blockMs ?? DEFAULT_BLOCK_MS
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS

    this.registerLuaCommands()
  }

  private resolveRetryInterval(options: RedisStreamsTransportOptions): number {
    const deprecated = options.retrySchedulerIntervalMs ?? options.reclaimIntervalMs
    if (deprecated !== undefined) {
      this.logger.warn(
        '`retrySchedulerIntervalMs` / `reclaimIntervalMs` are deprecated - retry scheduling and idle reclaim are ' +
          'one pass now. Use `retryIntervalMs`. Precedence: retryIntervalMs > retrySchedulerIntervalMs > ' +
          'reclaimIntervalMs.',
      )
    }
    return options.retryIntervalMs ?? deprecated ?? DEFAULT_RETRY_INTERVAL_MS
  }

  private resolveHorizon(): number {
    // A backoff is expressed as `IDLE horizon - backoff`, so the horizon must cover every level or Redis clamps the
    // deadline to `now` and the level silently collapses. `max()` over all levels, not the last: `backoffMultiplier`
    // below 1 is not validated upstream. Levels stop one short of `maxAttempts` - that attempt is DLQ'd, never parked.
    let horizon = this.minIdleMs
    for (let attempt = 1; attempt < this.retry.maxAttempts; attempt++) {
      horizon = Math.max(horizon, nextBackoffMs(attempt, this.retry))
    }
    if (!Number.isFinite(horizon) || horizon <= 0 || horizon > MAX_HORIZON_MS) {
      throw new Error(
        `[messaging-redis] Retry horizon ${horizon}ms is outside (0, ${MAX_HORIZON_MS}ms]. It is the max of ` +
          '`minIdleMs` and every backoff level; Redis accepts an out-of-range IDLE without complaint and parks the ' +
          'entry forever, so this fails at startup instead. Lower `retry.backoffMs` / `retry.backoffMultiplier` / ' +
          '`retry.maxAttempts` or `minIdleMs`.',
      )
    }
    return Math.ceil(horizon)
  }

  private registerLuaCommands(): void {
    // defineCommand adds methods on the client instance dynamically; ioredis types don't cover them.
    const c = this.client as unknown as {
      defineCommand: (name: string, options: { numberOfKeys: number; lua: string }) => void
    }
    c.defineCommand('parkRetry', { numberOfKeys: 1, lua: PARK_RETRY_SCRIPT })
    c.defineCommand('drainRetry', { numberOfKeys: 2, lua: DRAIN_RETRY_SCRIPT })
    c.defineCommand('moveToDlq', { numberOfKeys: 2, lua: DLQ_SCRIPT })
  }

  private get lua(): LuaCommands {
    return this.client as unknown as LuaCommands
  }

  private get raw(): RawCommands {
    return this.client as unknown as RawCommands
  }

  async onInit(): Promise<void> {
    // A user-supplied client's lifecycle belongs to the user - never connect or quit it.
    if (this.ownsClient && this.client.status !== 'ready') {
      await this.client.connect()
    }
    this.retryTimer = setInterval(() => {
      // Skip rather than queue: overlapping passes would only contend on the same PEL window.
      if (this.retryPass || this.stopping) return
      const pass = this.runRetryPass()
        .then(
          () => this.reportSuccess('retry pass'),
          (err) => this.reportFailure('retry pass', 'retry pass failed', String(err)),
        )
        .finally(() => {
          if (this.retryPass === pass) this.retryPass = undefined
        })
      this.retryPass = pass
    }, this.retryIntervalMs)
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatTick) return
      const tick = this.runHeartbeat()
        .then(
          () => this.reportSuccess('heartbeat'),
          (err) => this.reportFailure('heartbeat', 'heartbeat failed', String(err)),
        )
        .finally(() => {
          if (this.heartbeatTick === tick) this.heartbeatTick = undefined
        })
      this.heartbeatTick = tick
    }, this.heartbeatIntervalMs)
  }

  async onDestroy(): Promise<void> {
    this.stopping = true
    if (this.retryTimer) clearInterval(this.retryTimer)
    const drains = [...this.legacyDrains.values()]
    this.legacyDrains.clear()
    for (const state of drains) if (state.timer) clearTimeout(state.timer)

    // Snapshot before clearing - the lane clients are still needed below. Order matters: abort so the loop's catch
    // sees it, disconnect to break the in-flight BLOCK, drain the running pass and its handlers on ONE budget (their
    // XACK / Lua still go through the live pubClient), stop the heartbeat only after that drain so entries of handlers
    // still finishing stay invisible to other replicas, then XGROUP DESTROY broadcast groups before the quit they need.
    const subsSnapshot = this.subs
    this.subs = []
    for (const sub of subsSnapshot) sub.abort.abort()
    for (const sub of subsSnapshot) for (const lane of sub.lanes) lane.client.disconnect()

    const deadline = Date.now() + this.drainTimeoutMs
    if (this.drainTimeoutMs > 0) {
      if (this.retryPass && !(await this.awaitUntil(this.retryPass, deadline))) {
        this.logger.warn('Drain timeout: housekeeping pass still running')
      }
      // Legacy drains are a round trip each and share the same budget - a quit under one only logs noise.
      const running = drains.map((state) => state.running).filter((run) => run !== undefined)
      if (running.length > 0) await this.awaitUntil(Promise.all(running), deadline)
      await this.waitForDrain(deadline)
    }

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    // Only XCLAIM round trips, but `maxRetriesPerRequest: null` lets one queue forever on a wedged
    // connection, so it shares the drain ceiling rather than making shutdown unbounded.
    if (this.heartbeatTick) await this.awaitUntil(this.heartbeatTick, deadline)

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
    // Last, so a channel that recovered during the drain still gets to say so.
    this.failures.clear()
  }

  /**
   * Destroy broadcast groups left behind by previous incarnations of this process on this host. The suffix slice is
   * anchored on the current `hostname()` and pid rather than split greedily, because hostnames may themselves contain
   * underscores (`pod_abc_xyz_42`) and a mis-segmented match would destroy unrelated groups.
   */
  private async cleanupBroadcastOrphans(topic: string, currentGroup: string): Promise<void> {
    const host = hostname()
    const myPid = String(process.pid)
    const suffix = `__${host}_${myPid}`
    if (!currentGroup.endsWith(suffix)) {
      // Not formed by our broadcast derivation - skip rather than guess.
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
      await this.client
        .xgroup('DESTROY', topic, groupName)
        .catch((err) => this.logger.warn(`orphan cleanup failed for ${groupName}: ${String(err)}`))
      this.logger.log(`Cleaned up orphaned broadcast group ${groupName} on ${topic}`)
    }
  }

  /**
   * A housekeeping channel failed. The first failure of a run logs verbatim, then the channel goes quiet apart from
   * one line per `FAILURE_LOG_WINDOW_MS` carrying the running count: a dead Redis fails every channel every tick, and
   * the hundredth copy of one cause says nothing the first did not. A *changed* cause is a different matter - a sweep
   * that stops saying `Connection is closed` and starts saying `NOGROUP` is news, and waiting out the window would
   * bury it - so it skips the wait, up to `FAILURE_LOG_BURST` lines per window in case the detail never repeats.
   */
  private reportFailure(channel: string, message: string, detail: string): void {
    const now = Date.now()
    const run = this.failures.get(channel)
    if (!run) {
      this.failures.set(channel, { detail, count: 1, causeCount: 1, windowStartedAt: now, logsInWindow: 1 })
      this.logger.error(message, detail)
      return
    }
    run.count++
    if (now - run.windowStartedAt >= FAILURE_LOG_WINDOW_MS) {
      run.windowStartedAt = now
      run.logsInWindow = 0
    }
    const changed = detail !== run.detail
    // The count follows the cause, so the line a changed one prints counts that cause alone and starts at 1.
    run.causeCount = changed ? 1 : run.causeCount + 1
    run.detail = detail
    // An unchanged cause is worth the window's one periodic line and nothing more; a changed one jumps that queue.
    if (!changed && run.logsInWindow > 0) return
    if (run.logsInWindow >= FAILURE_LOG_BURST) return
    run.logsInWindow++
    this.logger.error(run.causeCount > 1 ? `${message} (${run.causeCount} consecutive failures)` : message, detail)
  }

  /** A housekeeping channel worked. Ends the run, announcing it if anything was suppressed. */
  private reportSuccess(channel: string): void {
    const run = this.failures.get(channel)
    if (!run) return
    this.failures.delete(channel)
    // Suppression is only safe because of this line: silence alone reads the same as a fix and as a worsening outage.
    if (run.count > 1) this.logger.log(`${channel} recovered after ${run.count} consecutive failures`)
  }

  /** Await `work`, giving up at `deadline`. Returns false on timeout. */
  private async awaitUntil(work: Promise<unknown>, deadline: number): Promise<boolean> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<'timeout'>((r) => {
      timer = setTimeout(() => r('timeout'), remaining)
    })
    try {
      const settled = work.then(
        () => 'done' as const,
        () => 'done' as const,
      )
      return (await Promise.race([settled, timeout])) === 'done'
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async waitForDrain(deadline: number): Promise<void> {
    if (this.pendingDeliveries.size === 0) return
    const drained = await this.awaitUntil(Promise.all([...this.pendingDeliveries]), deadline)
    if (!drained) {
      this.logger.warn(`Drain timeout: ${this.pendingDeliveries.size} handler(s) still in flight`)
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
    // Defensive default - the bus resolves and validates `mode` upstream, but direct callers may omit it.
    const mode: DispatchMode = options.mode ?? this.defaultMode
    const isBroadcast = options.broadcast === true

    if (isBroadcast) {
      await this.cleanupBroadcastOrphans(topic, group)
    }

    // Idempotent group creation - MKSTREAM auto-creates the stream if missing.
    try {
      await this.client.xgroup('CREATE', topic, group, '$', 'MKSTREAM')
    } catch (err) {
      if (!String(err).includes('BUSYGROUP')) throw err
    }

    // Lane fan-out: batch reads `COUNT=concurrency` on one lane (head-of-line within the batch), sliding spawns
    // `concurrency` lanes of `COUNT=1`, each with its own client and `:laneN` consumer name so Redis spreads entries.
    // Every lane is a connection, so sliding mode multiplies the transport's socket budget by `concurrency`.
    const laneCount = mode === 'sliding' ? concurrency : 1
    const perLaneCount = mode === 'sliding' ? 1 : concurrency

    const lanes: SubLane[] = []
    try {
      for (let i = 0; i < laneCount; i++) {
        const consumer = mode === 'sliding' ? `${this.consumerName}:lane${i}` : this.consumerName
        // lazyConnect override: we own the connect lifecycle even when the parent was eagerly connected.
        const client = this.client.duplicate({ lazyConnect: true })
        await client.connect()
        lanes.push({ client, consumer })
      }
    } catch (err) {
      // Mid-spawn failure: tear down already-connected lanes before bubbling.
      for (const lane of lanes) lane.client.disconnect()
      throw err
    }

    await this.startLegacyDrain(topic)

    const abort = new AbortController()
    const sub: ActiveSub = { topic, group, mode, concurrency, isBroadcast, handler, abort, lanes }
    this.subs.push(sub)
    for (const [i, lane] of lanes.entries()) {
      this.runConsumerLoop(sub, lane, perLaneCount, i).catch((err) => {
        this.logger.error(`Consumer loop ${topic} lane ${i} terminated`, String(err))
      })
    }

    return {
      unsubscribe: async () => {
        abort.abort()
        // Release the drain ref only on the first call - `unsubscribe()` is idempotent by contract.
        const idx = this.subs.indexOf(sub)
        if (idx >= 0) {
          this.subs.splice(idx, 1)
          this.stopLegacyDrain(topic)
          // One sweep serves every subscription on the pair, so only the last one out drops the run: leaving it would
          // grow the map with every subscription that comes and goes, dropping it early would reset a live count.
          if (!this.subs.some((s) => s.topic === topic && s.group === group)) {
            this.failures.delete(`retry sweep ${topic}/${group}`)
          }
        }
        // Sync in ioredis 5: tears the socket so each lane's in-flight BLOCK rejects and the loop exits via `aborted`.
        for (const lane of sub.lanes) lane.client.disconnect()
      },
    }
  }

  private async runConsumerLoop(sub: ActiveSub, lane: SubLane, perLaneCount: number, laneIndex: number): Promise<void> {
    while (!sub.abort.signal.aborted) {
      try {
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
        // `>` only yields entries never delivered to this group, so the delivery count is 1 and so is the attempt.
        await Promise.allSettled(
          messages.map((msg) => this.trackDelivery(this.processMessage(sub, msg, lane.consumer, 1))),
        )
      } catch (err) {
        if (sub.abort.signal.aborted) break

        // Stream or group deleted externally: shut the lane down instead of spamming a group that no longer exists.
        if (String(err).includes('NOGROUP')) {
          this.logger.warn(`Stream/group gone for ${sub.topic} lane ${laneIndex}, exiting consumer loop`)
          break
        }

        this.logger.error(`Consumer loop error for ${sub.topic} lane ${laneIndex}`, String(err))
        await this.abortableSleep(CONSUMER_ERROR_BACKOFF_MS, sub.abort.signal)
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

  /**
   * Register a delivery so `onDestroy()` drains it - housekeeping redeliveries included, they are the ones this
   * design adds. The returned promise never rejects, so callers can `race` it safely.
   */
  private trackDelivery(work: Promise<void>): Promise<void> {
    const tracked = work.catch((err) => {
      this.logger.error('Delivery failed', String(err))
    })
    this.pendingDeliveries.add(tracked)
    void tracked.finally(() => this.pendingDeliveries.delete(tracked))
    return tracked
  }

  private markInFlight(topic: string, group: string, id: string, consumer: string): void {
    let groups = this.inFlight.get(topic)
    if (!groups) {
      groups = new Map()
      this.inFlight.set(topic, groups)
    }
    let entries = groups.get(group)
    if (!entries) {
      entries = new Map()
      groups.set(group, entries)
    }
    entries.set(id, consumer)
  }

  private clearInFlight(topic: string, group: string, id: string): void {
    const groups = this.inFlight.get(topic)
    const entries = groups?.get(group)
    if (!groups || !entries) return
    entries.delete(id)
    if (entries.size === 0) groups.delete(group)
    if (groups.size === 0) this.inFlight.delete(topic)
  }

  private isInFlight(topic: string, group: string, id: string): boolean {
    return this.inFlight.get(topic)?.get(group)?.has(id) === true
  }

  private async processMessage(
    sub: ActiveSub,
    [id, fields]: [string, string[]],
    consumer: string,
    attempt: number,
  ): Promise<void> {
    this.markInFlight(sub.topic, sub.group, id, consumer)
    try {
      let envelope: MessageEnvelope
      try {
        envelope = parseEnvelopeFromFields(fields)
      } catch (err) {
        this.logger.error(`Failed to parse stream entry ${id}`, String(err))
        // Drop unparseable entries - no point retrying corrupt data.
        await this.client.xack(sub.topic, sub.group, id)
        return
      }

      // `meta.attempt` only carries the PEL delivery count to the handler. Skip the substitution when `lastError` is
      // set: that is a DLQ record, whose `attempt` describes the death of the original and would be clobbered by the
      // `.dlq` stream's own delivery count of 1. Legacy ZSET envelopes have no `lastError`, so they get a fresh budget.
      if (envelope.meta.lastError === undefined) {
        envelope = { ...envelope, meta: { ...envelope.meta, attempt } }
      } else {
        attempt = envelope.meta.attempt
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

      await this.handleNack(sub, id, consumer, envelope, attempt, result.error)
    } finally {
      this.clearInFlight(sub.topic, sub.group, id)
    }
  }

  private async handleNack(
    sub: ActiveSub,
    id: string,
    consumer: string,
    envelope: MessageEnvelope,
    attempt: number,
    error: Error,
  ): Promise<void> {
    // Exhaustion check 1 of 2: only this path knows WHY the message failed - the housekeeping pass sees a delivery
    // count and nothing else, so a DLQ record written there carries a synthetic error instead.
    if (attempt >= this.retry.maxAttempts) {
      await this.exhaust(sub, id, envelope, attempt, error)
      return
    }

    const backoff = nextBackoffMs(attempt, this.retry)
    // Unreachable for a normal envelope (the horizon covers every level); it guards a DLQ envelope replayed under a
    // different retry config, whose level can exceed our horizon.
    const idle = Math.max(0, this.horizonMs - backoff)

    // Deregister BEFORE parking, then let a heartbeat already in the air land: `IDLE 0` on a freshly parked entry
    // would reset its backoff to a full horizon.
    this.clearInFlight(sub.topic, sub.group, id)
    if (this.heartbeatTick) await this.heartbeatTick

    const parked = await this.lua.parkRetry(sub.topic, sub.group, id, consumer, idle)
    if (parked === -1) {
      this.logger.warn(
        `Entry ${id} on ${sub.topic} was reclaimed by another consumer while attempt ${attempt} was running; ` +
          'leaving the retry to its new owner',
      )
    } else if (parked === 0) {
      this.logger.warn(`Entry ${id} on ${sub.topic} is no longer pending; nothing to retry`)
    }
  }

  /** Exhaustion tail shared by the nack path and the abandoned-entry path. */
  private async exhaust(
    sub: ActiveSub,
    id: string,
    envelope: MessageEnvelope,
    attempt: number,
    error: Error,
  ): Promise<void> {
    if (!this.retry.dlq) {
      await this.client.xack(sub.topic, sub.group, id)
      this.logger.error(
        `Dropped ${envelope.id} on ${sub.topic} after ${this.retry.maxAttempts} attempts`,
        error.stack ?? error.message,
      )
      return
    }
    const dlqEnvelope = JSON.stringify({
      ...envelope,
      topic: dlqTopic(sub.topic),
      meta: { ...envelope.meta, attempt, lastError: error.message },
    })
    await this.lua.moveToDlq(sub.topic, dlqTopic(sub.topic), sub.group, id, dlqEnvelope)
  }

  /**
   * Transitional legacy-ZSET migration - see DRAIN_RETRY_SCRIPT. Keyed by topic, not by (topic, group): one
   * `${topic}:retry` key serves every group, so N groups must not probe it N times. The first drain is awaited, which
   * is what covers whatever a pre-PEL replica left behind before this process started; the rest ride the timer below,
   * off the retry tick because the key usually does not exist and the probe was two thirds of idle traffic.
   */
  private async startLegacyDrain(topic: string): Promise<void> {
    const existing = this.legacyDrains.get(topic)
    if (existing) {
      existing.refs++
      return
    }
    const state: LegacyDrain = { refs: 1, intervalMs: LEGACY_DRAIN_INTERVAL_MS }
    this.legacyDrains.set(topic, state)
    if ((await this.drainLegacy(topic)) > 0) state.intervalMs = this.legacyDrainFastMs
    this.scheduleLegacyDrain(topic, state)
  }

  private stopLegacyDrain(topic: string): void {
    const state = this.legacyDrains.get(topic)
    if (!state) return
    if (--state.refs > 0) return
    if (state.timer) clearTimeout(state.timer)
    this.legacyDrains.delete(topic)
    this.failures.delete(`legacy retry drain ${topic}`)
  }

  private scheduleLegacyDrain(topic: string, state: LegacyDrain): void {
    state.timer = setTimeout(() => {
      if (this.stopping || this.legacyDrains.get(topic) !== state) return
      const run = this.drainLegacy(topic)
        .then((moved) => {
          // Backoff shape: straight back to the retry cadence the moment an entry moves, because an old replica is
          // still writing; otherwise double up to the ceiling. Never stops - a long canary would strand messages.
          state.intervalMs =
            moved > 0 ? this.legacyDrainFastMs : Math.min(state.intervalMs * 2, LEGACY_DRAIN_MAX_INTERVAL_MS)
        })
        .finally(() => {
          if (state.running === run) state.running = undefined
          if (!this.stopping && this.legacyDrains.get(topic) === state) this.scheduleLegacyDrain(topic, state)
        })
      state.running = run
    }, state.intervalMs)
  }

  /** Never rejects: a failed migration probe must not take down the schedule or the subscribe that started it. */
  private drainLegacy(topic: string): Promise<number> {
    return this.lua.drainRetry(topic, `${topic}:retry`, Date.now(), DRAIN_BATCH).then(
      (moved) => {
        this.reportSuccess(`legacy retry drain ${topic}`)
        return moved
      },
      (err) => {
        this.reportFailure(`legacy retry drain ${topic}`, `legacy retry drain failed for ${topic}`, String(err))
        return 0
      },
    )
  }

  /** One housekeeping pass: a PEL sweep per subscribed (topic, group) pair. */
  private async runRetryPass(): Promise<void> {
    // `unsubscribe()` splices the live array, so iterate a snapshot. Pairs are deduplicated: two subscriptions on one
    // (topic, group) are competing consumers, and a single sweep serves both.
    const pairs = new Map<string, Map<string, ActiveSub>>()
    for (const sub of [...this.subs]) {
      let byGroup = pairs.get(sub.topic)
      if (!byGroup) {
        byGroup = new Map()
        pairs.set(sub.topic, byGroup)
      }
      if (!byGroup.has(sub.group)) byGroup.set(sub.group, sub)
    }

    for (const [topic, byGroup] of pairs) {
      if (this.stopping) return
      for (const sub of byGroup.values()) {
        if (this.stopping || sub.abort.signal.aborted) continue
        await this.sweepPending(sub).then(
          () => this.reportSuccess(`retry sweep ${topic}/${sub.group}`),
          (err) =>
            this.reportFailure(
              `retry sweep ${topic}/${sub.group}`,
              `retry sweep failed for ${topic}/${sub.group}`,
              String(err),
            ),
        )
      }
    }
  }

  /** Redeliver everything in this group's PEL idle past the horizon: elapsed backoffs and dead consumers alike. */
  private async sweepPending(sub: ActiveSub): Promise<void> {
    const { topic, group } = sub
    const consumer = `${this.consumerName}:retry`
    const limit = Math.max(1, sub.concurrency)
    const running = new Set<Promise<void>>()
    // A sweep never outlives the gap to the next pass; what it does not get through this time, the next one picks up.
    const deadline = Date.now() + this.retryIntervalMs
    // Exclusive `(<id>` cursor: entries we are still processing sit at the head of the PEL and would otherwise pin
    // every window to the same first page, hiding the abandoned entries behind them.
    let cursor = '-'

    while (!this.stopping && !sub.abort.signal.aborted) {
      const window = (await this.raw.xpending(topic, group, 'IDLE', this.horizonMs, cursor, '+', PENDING_PAGE)) as
        | PendingEntry[]
        | null
      if (!window || window.length === 0) return
      cursor = `(${window[window.length - 1]![0]}`

      for (const [id, , , deliveryCount] of window) {
        if (this.stopping || sub.abort.signal.aborted) return
        if (this.isInFlight(topic, group, id)) continue

        // Exhaustion check 2 of 2, and it must happen BEFORE the claim, or a poison message that killed the process
        // gets one attempt more than `maxAttempts`. The count is post-claim, so `>= maxAttempts` means the handler
        // has already run that many times.
        if (deliveryCount >= this.retry.maxAttempts) {
          await this.exhaustAbandoned(sub, id, consumer, deliveryCount)
          continue
        }

        const claimed = await this.claim(topic, group, consumer, id)
        if (!claimed) continue

        // INVARIANT: `XCLAIM` bumps the delivery count by exactly 1 and post-claim count == handler invocations, so
        // this delivery's attempt is the pre-claim `deliveryCount + 1`.
        const delivery = this.trackDelivery(this.processMessage(sub, claimed, consumer, deliveryCount + 1))
        running.add(delivery)
        void delivery.finally(() => running.delete(delivery))
        // Cap redeliveries at the subscription's concurrency: 50 abandoned entries must not run 50 handlers at once.
        if (running.size >= limit && !(await this.awaitUntil(Promise.race(running), deadline))) {
          // Passes are single-flight for the whole transport, so waiting out a handler that never settles would
          // starve every other pair. Leave it running - it stays in-flight, so the next pass skips it and moves on.
          this.logger.warn(`Retry pass gave up waiting on redeliveries for ${topic}/${group}`)
          return
        }
      }

      if (window.length < PENDING_PAGE) return
    }
  }

  /** DLQ (or drop) an entry whose delivery budget ran out while nobody was holding it. */
  private async exhaustAbandoned(sub: ActiveSub, id: string, consumer: string, deliveryCount: number): Promise<void> {
    // Claim first: the DLQ record needs the payload, and the claim is what keeps a second replica's pass out.
    const claimed = await this.claim(sub.topic, sub.group, consumer, id)
    if (!claimed) return
    let envelope: MessageEnvelope
    try {
      envelope = parseEnvelopeFromFields(claimed[1])
    } catch (err) {
      this.logger.error(`Failed to parse stream entry ${id}`, String(err))
      await this.client.xack(sub.topic, sub.group, id)
      return
    }
    // Synthetic: nobody was alive to report the real failure.
    const error = new Error(`Abandoned on ${sub.topic} after ${deliveryCount} delivery attempt(s) without ack or retry`)
    await this.exhaust(sub, id, envelope, deliveryCount, error)
  }

  /**
   * Take ownership of a pending entry, or null when somebody else got there first. `min-idle = horizon` is the mutual
   * exclusion: the winner's claim resets idle to 0, so a concurrent pass on another replica gets an empty reply
   * instead of a second delivery.
   */
  private async claim(topic: string, group: string, consumer: string, id: string): Promise<[string, string[]] | null> {
    const reply = (await this.raw.xclaim(topic, group, consumer, this.horizonMs, id)) as ClaimedEntry[] | null
    const entry = reply?.[0]
    if (entry) return entry
    if (reply && reply.length > 0) {
      // Redis < 7 answers `[null]` for an entry trimmed out of the stream while still pending (7.x drops it from the
      // PEL itself). The payload is gone either way - ack the ghost so the PEL stops pointing at it.
      this.logger.error(`Pending entry ${id} on ${topic} no longer exists in the stream (trimmed); acking`)
      await this.client.xack(topic, group, id)
    }
    return null
  }

  /**
   * Keep every entry we are still processing from crossing the horizon. Keyed per (topic, group, consumer) rather
   * than per pair so ownership stays with the lane that read the entry: `:laneN` diagnostics survive, and the
   * ownership gate in `parkRetry` keeps matching.
   */
  private async runHeartbeat(): Promise<void> {
    const pairs: Array<[string, string]> = []
    for (const [topic, groups] of this.inFlight) {
      for (const group of groups.keys()) pairs.push([topic, group])
    }

    for (const [topic, group] of pairs) {
      // Re-read membership per pair rather than snapshotting the whole tick: each pair costs a round trip, and an
      // `IDLE 0` on an entry parked by a nack in the meantime would turn its backoff into a full horizon.
      const entries = this.inFlight.get(topic)?.get(group)
      if (!entries || entries.size === 0) continue

      const byConsumer = new Map<string, string[]>()
      for (const [id, consumer] of entries) {
        const ids = byConsumer.get(consumer)
        if (ids) ids.push(id)
        else byConsumer.set(consumer, [id])
      }

      for (const [consumer, ids] of byConsumer) {
        for (let i = 0; i < ids.length; i += HEARTBEAT_BATCH) {
          const chunk = ids.slice(i, i + HEARTBEAT_BATCH)
          await this.raw.xclaim(topic, group, consumer, 0, ...chunk, 'IDLE', 0, 'JUSTID')
        }
      }
    }
  }
}

export function redisStreamsTransport(options: RedisStreamsTransportOptions): MessageTransport {
  return new RedisStreamsTransport(options)
}
