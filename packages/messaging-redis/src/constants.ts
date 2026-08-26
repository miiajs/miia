// Internal defaults and tunables for the Redis Streams transport.

/**
 * Ceiling for the computed retry horizon (24h). Redis accepts an out-of-range `IDLE` without complaint and parks the
 * entry forever, so a horizon past this is a config mistake and fails at construction.
 */
export const MAX_HORIZON_MS = 24 * 60 * 60 * 1000
/** Default housekeeping cadence. */
export const DEFAULT_RETRY_INTERVAL_MS = 1000
/** Default floor for the retry horizon. */
export const DEFAULT_MIN_IDLE_MS = 60000
/** Default `XREADGROUP BLOCK` timeout. */
export const DEFAULT_BLOCK_MS = 5000
/** Default budget `onDestroy()` gives the running pass plus its in-flight handlers. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 5000
/** Floor for the heartbeat interval derived from `horizon / 2`. */
export const MIN_HEARTBEAT_INTERVAL_MS = 50
/** Pause before a consumer loop re-blocks after a transient error. */
export const CONSUMER_ERROR_BACKOFF_MS = 1000
/** Entries per `XPENDING` window during a housekeeping pass. */
export const PENDING_PAGE = 50
/** Max ids per heartbeat `XCLAIM`. */
export const HEARTBEAT_BATCH = 100
/** Max legacy ZSET entries moved back into the stream per pass. */
export const DRAIN_BATCH = 100
/**
 * How long a housekeeping channel stays quiet after its first logged failure. 60s: an outage costs a line a minute per
 * channel instead of one per `retryIntervalMs` tick, and a log read mid-outage is never more than a minute stale.
 */
export const FAILURE_LOG_WINDOW_MS = 60000
/**
 * Lines one housekeeping channel may emit per window, a changed cause included. 3: a new cause is news and skips the
 * wait, but a detail that never repeats (one embedding a script sha, an id, a timestamp) buys 3 lines a window rather
 * than one a tick.
 */
export const FAILURE_LOG_BURST = 3
/**
 * Base cadence of the transitional legacy-ZSET drain, off the retry tick. 10s: the key usually does not exist, and an
 * entry an old replica leaves behind is already waiting out its own backoff, so 10x cheaper than the 1s tick costs it
 * nothing that matters.
 */
export const LEGACY_DRAIN_INTERVAL_MS = 10000
/** Ceiling for the legacy-drain backoff: a stranded entry must still be picked up within a minute. */
export const LEGACY_DRAIN_MAX_INTERVAL_MS = 60000
