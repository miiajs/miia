/**
 * Lua scripts for atomic retry/DLQ operations against Redis Streams.
 *
 * All three run server-side and avoid race conditions between acking a
 * pending entry and scheduling its replacement. Without atomicity a process
 * crash between XACK and ZADD (or between XACK and the DLQ XADD) would
 * silently drop the message.
 *
 * The transport registers these scripts via ioredis `defineCommand()` so they
 * run with SHA caching (EVALSHA fast path) instead of re-sending the body.
 */

/**
 * XACK the nacked entry and enqueue a fresh copy (with incremented attempt)
 * into the retry ZSET, scored by the absolute epoch ms at which the entry
 * becomes eligible for redelivery.
 *
 * KEYS[1] = main stream topic
 * KEYS[2] = retry ZSET key (e.g. `${topic}:retry`)
 * ARGV[1] = consumer group
 * ARGV[2] = stream entry id being acked
 * ARGV[3] = retry-at epoch ms (ZSET score)
 * ARGV[4] = new envelope JSON (ZSET member)
 */
export const RETRY_SCHEDULE_SCRIPT = `
redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
return 1
`

/**
 * Move every due entry (score <= now) from the retry ZSET back into the
 * main stream, then remove them from the ZSET. Returns the number of
 * entries moved.
 *
 * KEYS[1] = main stream topic
 * KEYS[2] = retry ZSET key
 * ARGV[1] = now epoch ms
 * ARGV[2] = max entries to drain per call
 */
export const DRAIN_RETRY_SCRIPT = `
local due = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for _, envelope in ipairs(due) do
  redis.call('XADD', KEYS[1], '*', 'data', envelope)
  redis.call('ZREM', KEYS[2], envelope)
end
return #due
`

/**
 * XACK the failed entry and publish the envelope (with lastError in meta)
 * to the DLQ stream in a single atomic operation.
 *
 * KEYS[1] = main stream topic
 * KEYS[2] = DLQ stream topic (e.g. `${topic}.dlq`)
 * ARGV[1] = consumer group
 * ARGV[2] = stream entry id being acked
 * ARGV[3] = envelope JSON (with meta.lastError filled in)
 */
export const DLQ_SCRIPT = `
redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
redis.call('XADD', KEYS[2], '*', 'data', ARGV[3])
return 1
`
