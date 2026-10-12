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
  type InitialPosition,
  type InitialPositionKind,
  nextBackoffMs,
  type RetryConfig,
  type SubscribeOptions,
  type Subscription,
} from '@miiajs/messaging'
import { Redis } from 'ioredis'
import {
  ALIVE_KEY_PREFIX,
  ALIVE_REFRESH_MS,
  ALIVE_TTL_MS,
  CONSUMER_ERROR_BACKOFF_MS,
  DEFAULT_BLOCK_MS,
  DEFAULT_DRAIN_TIMEOUT_MS,
  DEFAULT_MIN_IDLE_MS,
  DEFAULT_RETRY_INTERVAL_MS,
  FAILURE_LOG_BURST,
  FAILURE_LOG_WINDOW_MS,
  HEARTBEAT_BATCH,
  MAX_HORIZON_MS,
  MIN_HEARTBEAT_INTERVAL_MS,
  PENDING_PAGE,
} from './constants.js'
import { DLQ_SCRIPT, PARK_RETRY_SCRIPT } from './retry-queue.js'
import { parseEnvelopeFromFields } from './serialization.js'

/** Derived from the writer so the dead-letter check cannot drift from the naming it is checking for. */
const DLQ_SUFFIX = dlqTopic('')

export interface RedisStreamsTransportOptions {
  /** Redis URL (e.g. `redis://localhost:6379`). Mutually exclusive with `client`. */
  url?: string
  /** Pre-built ioredis instance. Takes precedence over `url`. */
  client?: Redis
  retry?: Partial<RetryConfig>
  /** Housekeeping cadence, and so the granularity of backoff timing and crash detection. Default 1000ms. */
  retryIntervalMs?: number
  /**
   * Floor for the retry horizon, in ms. Default 60000. The horizon is the idle threshold at which a pending entry
   * counts as abandoned, so this is also the crash-detection latency.
   */
  minIdleMs?: number
  /** Overrides the auto-generated consumer name (`hostname:pid:rand8`). */
  consumerName?: string
  /**
   * `XREADGROUP BLOCK` timeout in ms. Default 5000. Governs idle Redis traffic and error-recovery cadence only - new
   * messages wake the blocked read immediately, and shutdown disconnects the socket rather than waiting it out. On
   * Redis 6.2 it also bounds how late a lane notices its stream was deleted while nothing is published to it.
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
  /** Where a recreated group starts when this process knows no position for it. */
  initialPosition: InitialPosition
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

/** Order two stream ids. Both halves of `<ms>-<seq>` are 64-bit, so they are compared as BigInt. */
function compareStreamIds(a: string, b: string): number {
  const [aMs = '0', aSeq = '0'] = a.split('-')
  const [bMs = '0', bSeq = '0'] = b.split('-')
  const diff = BigInt(aMs) === BigInt(bMs) ? BigInt(aSeq) - BigInt(bSeq) : BigInt(aMs) - BigInt(bMs)
  return diff === 0n ? 0 : diff < 0n ? -1 : 1
}

/**
 * A backoff level as an integer. Redis rejects a fractional `IDLE`, which any non-integral `backoffMultiplier`
 * produces, and the horizon has to round the same way or it can land below the largest idle a park asks for.
 */
function backoffLevelMs(attempt: number, retry: RetryConfig): number {
  return Math.ceil(nextBackoffMs(attempt, retry))
}

// Signatures for the Lua commands registered via ioredis defineCommand().
// TS doesn't learn those dynamically, so we keep them as a narrow cast target.
interface LuaCommands {
  parkRetry(streamKey: string, group: string, entryId: string, consumer: string, idleMs: number): Promise<number>
  moveToDlq(streamKey: string, dlqKey: string, group: string, entryId: string, envelopeJson: string): Promise<number>
}

// ioredis 5 types don't cover `XPENDING`'s extended form or variadic ids in
// front of `IDLE` / `JUSTID`, so both go through an untyped view.
interface RawCommands {
  xpending(...args: unknown[]): Promise<unknown>
  xclaim(...args: unknown[]): Promise<unknown>
}

/**
 * Redis Streams transport for `@miiajs/messaging`. `publish()` is `XADD`; `subscribe()` joins a consumer group -
 * creating it at the subscription's `initialPosition` when it does not exist - and reads it with
 * `XREADGROUP ... BLOCK`, recreating the group if it disappears underneath. Four moving parts:
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
  readonly supportedInitialPositions = ['latest', 'earliest', 'since'] as const satisfies readonly InitialPositionKind[]

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
  /**
   * `channel -> current failure run`, one entry per unit that can fail on its own: each (topic, group) sweep and its
   * lanes' group, the heartbeat, the liveness key. Only ever read back whole, so the key doubles as the channel's log
   * name.
   */
  private failures = new Map<string, FailureRun>()
  private timeFallbackWarned = false
  /** `topic -> group -> highest known position`: at subscribe, then the last entry read. A lost group resumes there. */
  private lastRead = new Map<string, Map<string, string>>()
  private seedWarned = false
  /** Present and fresh while this process lives - what keeps its broadcast groups out of other processes' cleanup. */
  private readonly aliveKey = `${ALIVE_KEY_PREFIX}${hostname()}_${process.pid}`
  private aliveRefreshMs = ALIVE_REFRESH_MS
  /** The one-off second orphan cleanup: a predecessor that crashed just before we started still had a live key. */
  private aliveRecheckMs = ALIVE_TTL_MS + ALIVE_REFRESH_MS
  private aliveTimer?: ReturnType<typeof setInterval>
  /** The liveness refresh currently in flight, if any. Never rejects. */
  private aliveTick?: Promise<void>
  private aliveRecheck?: ReturnType<typeof setTimeout>
  /** `SET` on the liveness key was denied: no liveness, and so no orphan cleanup either. */
  private aliveDisabled = false

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
    this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS
    this.minIdleMs = options.minIdleMs ?? DEFAULT_MIN_IDLE_MS
    this.horizonMs = this.resolveHorizon()
    this.heartbeatIntervalMs = Math.max(MIN_HEARTBEAT_INTERVAL_MS, Math.floor(this.horizonMs / 2))
    this.blockMs = options.blockMs ?? DEFAULT_BLOCK_MS
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS

    this.registerLuaCommands()
  }

  private resolveHorizon(): number {
    // A backoff is expressed as `IDLE horizon - backoff`, so the horizon must cover every level or Redis clamps the
    // deadline to `now` and the level silently collapses. `max()` over all levels, not the last: `backoffMultiplier`
    // below 1 is not validated upstream. Levels stop one short of `maxAttempts` - that attempt is DLQ'd, never parked.
    let horizon = this.minIdleMs
    for (let attempt = 1; attempt < this.retry.maxAttempts; attempt++) {
      horizon = Math.max(horizon, backoffLevelMs(attempt, this.retry))
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
    if (this.aliveRecheck) clearTimeout(this.aliveRecheck)
    this.aliveRecheck = undefined

    // Snapshot before clearing - the lane clients are still needed below. Order matters: abort so the loop's catch
    // sees it, disconnect to break the in-flight BLOCK, drain the running pass and its handlers on ONE budget (their
    // XACK / Lua still go through the live pubClient), stop the heartbeat and the liveness refresh only after that
    // drain so entries of handlers still finishing stay invisible to other replicas and broadcast groups stay out of
    // their orphan cleanup, then XGROUP DESTROY broadcast groups before the quit they need.
    const subsSnapshot = this.subs
    this.subs = []
    for (const sub of subsSnapshot) sub.abort.abort()
    for (const sub of subsSnapshot) for (const lane of sub.lanes) lane.client.disconnect()

    const deadline = Date.now() + this.drainTimeoutMs
    if (this.drainTimeoutMs > 0) {
      if (this.retryPass && !(await this.awaitUntil(this.retryPass, deadline))) {
        this.logger.warn('Drain timeout: housekeeping pass still running')
      }
      await this.waitForDrain(deadline)
    }

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.aliveTimer) clearInterval(this.aliveTimer)
    this.aliveTimer = undefined
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
   * Destroy this handler's broadcast groups whose owner is gone, from any host: a live owner keeps its liveness key
   * fresh, a crashed one lets it expire. Does nothing while liveness is off.
   */
  private async cleanupBroadcastOrphans(topic: string, currentGroup: string): Promise<void> {
    const suffix = `__${hostname()}_${process.pid}`
    if (!currentGroup.endsWith(suffix)) return // not formed by our broadcast derivation - skip rather than guess
    const base = currentGroup.slice(0, -suffix.length)
    // `<base>__<host>_<pid>` from any host; the owner part is its liveness key name. An owner starting with `_` or
    // containing `__` is a sibling handler whose method extends ours (`handle_`, `handle__v2`) - skip it.
    const pattern = new RegExp(`^${escapeRegex(base)}__([^_](?:(?!__).)*_\\d+)$`)

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
    if (this.aliveDisabled) return

    for (const groupInfo of groups) {
      // groupInfo format: ['name', '<groupname>', 'consumers', N, ...]
      const groupName = String(groupInfo[1])
      if (groupName === currentGroup) continue
      const owner = pattern.exec(groupName)?.[1]
      if (!owner) continue
      const alive = await this.client.exists(`${ALIVE_KEY_PREFIX}${owner}`).catch((err) => {
        this.logger.warn(`liveness check failed for ${groupName}: ${String(err)}`)
        return 1 // unknown -> keep
      })
      if (alive) continue
      const destroyed = await this.client.xgroup('DESTROY', topic, groupName).catch((err) => {
        this.logger.warn(`orphan cleanup failed for ${groupName}: ${String(err)}`)
        return 0
      })
      // Replicas starting together all see the same orphan; only the one whose DESTROY removed it says so.
      if (destroyed === 1) this.logger.log(`Cleaned up orphaned broadcast group ${groupName} on ${topic}`)
    }
  }

  /**
   * Create the group unless it exists - an existing group is never moved, whatever position is asked for. Broadcast
   * groups start at `$` regardless: they live and die with this process.
   */
  private async ensureGroup(
    topic: string,
    group: string,
    position: InitialPosition,
    isBroadcast: boolean,
  ): Promise<void> {
    const start = isBroadcast ? '$' : await this.groupStartId(position)
    await this.createGroup(topic, group, start, isBroadcast)
  }

  /** `XGROUP CREATE` at `start`, a no-op for a group that exists. MKSTREAM auto-creates the stream if missing. */
  private async createGroup(topic: string, group: string, start: string, isBroadcast: boolean): Promise<void> {
    try {
      await this.client.xgroup('CREATE', topic, group, start, 'MKSTREAM')
    } catch (err) {
      if (String(err).includes('BUSYGROUP')) return
      throw err
    }
    if (!isBroadcast) this.logger.log(`Created consumer group ${group} on ${topic} at ${start}`)
  }

  /**
   * Remember where the group stands right after subscribe, so a lane that has read nothing yet still recreates it from
   * there rather than from `initialPosition`. Rows are parsed by field name: 7.x adds `entries-read` and `lag`.
   */
  private async seedLastRead(topic: string, group: string): Promise<void> {
    let rows: unknown[][]
    try {
      rows = (await this.client.xinfo('GROUPS', topic)) as unknown[][]
    } catch (err) {
      if (!this.seedWarned) {
        this.seedWarned = true
        this.logger.warn(
          `xinfo GROUPS failed for ${topic} - a group recreated after NOGROUP starts at its initialPosition: ` +
            String(err),
        )
      }
      return
    }
    for (const row of rows) {
      const info = new Map<string, unknown>()
      for (let i = 0; i + 1 < row.length; i += 2) info.set(String(row[i]), row[i + 1])
      if (String(info.get('name')) !== group) continue
      const id = info.get('last-delivered-id')
      if (typeof id === 'string') this.noteRead(topic, group, id)
      return
    }
  }

  private noteRead(topic: string, group: string, id: string): void {
    let groups = this.lastRead.get(topic)
    if (!groups) {
      groups = new Map()
      this.lastRead.set(topic, groups)
    }
    const known = groups.get(group)
    if (known === undefined || compareStreamIds(id, known) > 0) groups.set(group, id)
  }

  /**
   * Recreate a vanished group from the highest position this process knows for it, else from `initialPosition`.
   * Broadcast: no await before the CREATE, so `onDestroy`'s `XGROUP DESTROY` on the same connection lands after it.
   */
  private async recoverGroup(sub: ActiveSub): Promise<void> {
    const known = this.lastRead.get(sub.topic)?.get(sub.group)
    if (sub.isBroadcast) this.markAlive().catch(() => {})
    const start = known ?? (sub.isBroadcast ? '$' : await this.groupStartId(sub.initialPosition))
    await this.createGroup(sub.topic, sub.group, start, sub.isBroadcast)
  }

  /**
   * Start refreshing this process's liveness key, once per transport. The key is never deleted - it expires
   * `ALIVE_TTL_MS` after the last refresh, and the groups it protects are destroyed on graceful shutdown anyway.
   */
  private async startLiveness(): Promise<void> {
    if (this.stopping || this.aliveTimer || this.aliveDisabled) return
    // Armed before the first await, so two concurrent first subscribes cannot start two.
    this.aliveTimer = setInterval(() => {
      if (this.aliveTick) return
      const tick = this.markAlive()
        .then(
          () => {
            if (!this.stopping) this.reportSuccess('liveness key')
          },
          (err) => {
            if (!this.stopping) this.reportFailure('liveness key', 'liveness key refresh failed', String(err))
          },
        )
        .finally(() => {
          if (this.aliveTick === tick) this.aliveTick = undefined
        })
      this.aliveTick = tick
    }, this.aliveRefreshMs)
    this.aliveRecheck = setTimeout(() => {
      this.aliveRecheck = undefined
      void this.recheckOrphans()
    }, this.aliveRecheckMs)
    try {
      await this.markAlive()
    } catch (err) {
      clearInterval(this.aliveTimer)
      clearTimeout(this.aliveRecheck)
      this.aliveTimer = undefined
      this.aliveRecheck = undefined
      const msg = String(err)
      if (!msg.includes('NOPERM')) throw err
      this.aliveDisabled = true
      this.logger.warn(
        `SET on ${this.aliveKey} rejected - broadcast orphan cleanup is off. Grant SET and EXISTS on ` +
          `${ALIVE_KEY_PREFIX}* to turn it on: ${msg}`,
      )
    }
  }

  private async markAlive(): Promise<void> {
    if (this.aliveDisabled) return
    await this.client.set(this.aliveKey, '1', 'PX', ALIVE_TTL_MS)
  }

  /** Orphan cleanup again, for the groups of predecessors whose keys were still alive when this process subscribed. */
  private async recheckOrphans(): Promise<void> {
    for (const sub of [...this.subs]) {
      if (this.stopping) return
      if (!sub.isBroadcast || sub.abort.signal.aborted) continue
      await this.cleanupBroadcastOrphans(sub.topic, sub.group).catch((err) =>
        this.logger.warn(`orphan re-check failed for ${sub.group} on ${sub.topic}: ${String(err)}`),
      )
    }
  }

  /**
   * `XGROUP CREATE` start id: `$` for latest, `0` for earliest, `<ms>-0` for a window - ids carry the Redis clock.
   * Throws on anything else: the bus validates, but a direct caller's `{ since: NaN }` would otherwise replay the whole
   * stream and a negative `since` would start the group in the future and skip new entries.
   */
  private async groupStartId(position: InitialPosition): Promise<string> {
    if (position === 'latest') return '$'
    if (position === 'earliest') return '0'
    const since = (position as { since?: unknown } | null)?.since
    if (typeof since !== 'number' || !Number.isInteger(since) || since < 1) {
      throw new Error(`[messaging-redis] Invalid initialPosition ${JSON.stringify(position)}`)
    }
    const cutoff = (await this.redisNowMs()) - since
    return cutoff > 0 ? `${cutoff}-0` : '0'
  }

  /**
   * Redis clock in ms. Only a denied or unknown `TIME` (ACL category `@fast` only, or a proxy that does not know it)
   * falls back to the process clock - any other error would fail the `XGROUP CREATE` right after it anyway.
   */
  private async redisNowMs(): Promise<number> {
    try {
      const [seconds, micros] = await this.client.time()
      return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000)
    } catch (err) {
      const msg = String(err)
      if (!msg.includes('NOPERM') && !/unknown command|unsupported command/i.test(msg)) throw err
      if (!this.timeFallbackWarned) {
        this.timeFallbackWarned = true
        this.logger.warn(
          `TIME rejected - a new group with initialPosition.since is measured on the process clock: ${msg}`,
        )
      }
      return Date.now()
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

    // The liveness key exists before our group does, so no other process ever sees the group without it.
    if (isBroadcast) {
      await this.startLiveness()
      await this.cleanupBroadcastOrphans(topic, group)
    }

    const initialPosition = options.initialPosition ?? 'latest'
    await this.ensureGroup(topic, group, initialPosition, isBroadcast)
    await this.seedLastRead(topic, group)

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

    const abort = new AbortController()
    const sub: ActiveSub = { topic, group, mode, concurrency, isBroadcast, initialPosition, handler, abort, lanes }
    this.subs.push(sub)
    for (const [i, lane] of lanes.entries()) {
      this.runConsumerLoop(sub, lane, perLaneCount, i).catch((err) => {
        this.logger.error(`Consumer loop ${topic} lane ${i} terminated`, String(err))
      })
    }

    return {
      unsubscribe: async () => {
        abort.abort()
        // Only the first call finds the sub - `unsubscribe()` is idempotent by contract.
        const idx = this.subs.indexOf(sub)
        if (idx >= 0) {
          this.subs.splice(idx, 1)
          // One sweep serves every subscription on the pair, so only the last one out drops the run: leaving it would
          // grow the map with every subscription that comes and goes, dropping it early would reset a live count.
          if (!this.subs.some((s) => s.topic === topic && s.group === group)) {
            this.failures.delete(`retry sweep ${topic}/${group}`)
            this.failures.delete(`heartbeat ${topic}/${group}`)
            this.failures.delete(`group ${topic}/${group}`)
            const known = this.lastRead.get(topic)
            known?.delete(group)
            if (known?.size === 0) this.lastRead.delete(topic)
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
        this.reportSuccess(`group ${sub.topic}/${sub.group}`)

        if (!result || sub.abort.signal.aborted) continue

        const messages = result[0]?.[1] ?? []
        // Recorded before the handlers run: a lane that recovers the group meanwhile must not start below them.
        if (messages.length > 0) this.noteRead(sub.topic, sub.group, messages[messages.length - 1]![0])
        // `>` only yields entries never delivered to this group, so the delivery count is 1 and so is the attempt.
        await Promise.allSettled(
          messages.map((msg) => this.trackDelivery(this.processMessage(sub, msg, lane.consumer, 1))),
        )
      } catch (err) {
        if (sub.abort.signal.aborted) break

        // Group or stream gone (Redis restarted empty, flushed, key evicted, deleted by hand): recreate it and keep
        // reading, with a backoff so a lane that keeps failing does not spin. 7.0 says UNBLOCKED here, not NOGROUP.
        const msg = String(err)
        if (msg.includes('NOGROUP') || msg.includes('no longer exists')) {
          const channel = `group ${sub.topic}/${sub.group}`
          this.reportFailure(channel, `Consumer group ${sub.group} on ${sub.topic} is gone, recreating it`, msg)
          if (!this.stopping) {
            await this.recoverGroup(sub).catch((createErr) => {
              if (!sub.abort.signal.aborted) {
                this.reportFailure(channel, `Failed to recreate ${sub.group} on ${sub.topic}`, String(createErr))
              }
            })
          }
          await this.abortableSleep(CONSUMER_ERROR_BACKOFF_MS, sub.abort.signal)
          continue
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
      // `.dlq` stream's own delivery count of 1.
      if (envelope.meta.lastError === undefined) {
        envelope = { ...envelope, meta: { ...envelope.meta, attempt } }
      } else {
        // A record replayed by hand can carry anything as `attempt`; a non-numeric one would reach `IDLE` as NaN.
        const declared = envelope.meta.attempt
        attempt = Number.isInteger(declared) && declared >= 1 ? declared : 1
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

    const backoff = backoffLevelMs(attempt, this.retry)
    // Unreachable for a normal envelope (the horizon covers every level); it guards a DLQ envelope replayed under a
    // different retry config, whose level can exceed our horizon.
    const idle = Math.max(0, this.horizonMs - backoff)

    // Deregister BEFORE parking, then let a heartbeat already in the air land: `IDLE 0` on a freshly parked entry
    // would reset its backoff to a full horizon.
    this.clearInFlight(sub.topic, sub.group, id)
    // Bounded like the shutdown drain and for the same reason: `maxRetriesPerRequest: null` lets a heartbeat command
    // queue forever on a wedged connection, and every nacking handler would queue behind it. Giving up costs at worst
    // a stale `IDLE 0` landing after the park - a retry delayed by one horizon, never a lost message.
    if (this.heartbeatTick) await this.awaitUntil(this.heartbeatTick, Date.now() + this.heartbeatIntervalMs)

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
    // `lastError` is written only by the DLQ move below, so it is the honest marker of a dead-letter record; the
    // `.dlq` suffix alone proves nothing, since a user is free to name an ordinary topic `billing.dlq` and dropping
    // their exhausted messages would lose data.
    const alreadyDeadLettered = envelope.meta.lastError !== undefined && sub.topic.endsWith(DLQ_SUFFIX)

    if (!this.retry.dlq || alreadyDeadLettered) {
      await this.client.xack(sub.topic, sub.group, id)
      const because = alreadyDeadLettered ? ' - already a dead-letter record, not nesting another DLQ' : ''
      this.logger.error(
        `Dropped ${envelope.id} on ${sub.topic} after ${this.retry.maxAttempts} attempts${because}`,
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

      // Isolated per pair like the sweep: one pair answering NOGROUP must not cost every other topic its renewals,
      // which is exactly the second delivery of a still-running handler the heartbeat exists to prevent.
      await this.renewPair(topic, group, entries).then(
        () => this.reportSuccess(`heartbeat ${topic}/${group}`),
        (err) =>
          this.reportFailure(`heartbeat ${topic}/${group}`, `heartbeat failed for ${topic}/${group}`, String(err)),
      )
    }
  }

  /** Renew one pair's entries, batched per owning consumer. */
  private async renewPair(topic: string, group: string, entries: Map<string, string>): Promise<void> {
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

export function redisStreamsTransport(options: RedisStreamsTransportOptions): MessageTransport {
  return new RedisStreamsTransport(options)
}
