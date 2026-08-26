// Lua scripts for the atomic retry/DLQ steps, registered by the transport via ioredis `defineCommand()` so they run
// server-side with SHA caching. Each one guards a decision two replicas can reach in the same housekeeping window.

/**
 * Re-park a nacked entry in the PEL with a computed idle time, but only if this consumer still owns it. The ownership
 * gate is the whole point: `XCLAIM ... min-idle 0` ignores idle time entirely, so an ungated call would steal the
 * entry back after another replica legitimately reclaimed it (our heartbeat lapsed, its pass took over) and run the
 * handler past `maxAttempts`. `IDLE` not `TIME`, so the deadline comes off Redis's own clock rather than a skewed app
 * clock. `JUSTID`, because parking is not a delivery and must not burn an attempt.
 *
 * KEYS[1] = main stream topic
 * ARGV[1] = consumer group, ARGV[2] = entry id, ARGV[3] = consumer that must still own it, ARGV[4] = idle ms
 * Returns 1 when parked, 0 when the entry is no longer pending, -1 when another consumer owns it now.
 */
export const PARK_RETRY_SCRIPT = `
local pending = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1)
if #pending == 0 then return 0 end
if pending[1][2] ~= ARGV[3] then return -1 end
redis.call('XCLAIM', KEYS[1], ARGV[1], ARGV[3], 0, ARGV[2], 'IDLE', ARGV[4], 'JUSTID')
return 1
`

/**
 * Move every due entry (score <= now) from the legacy retry ZSET back into the main stream. Transitional: retries no
 * longer use a ZSET, this only covers entries a pre-PEL replica scheduled during a rolling deploy. Atomic because N
 * replicas draining with `ZRANGE + XADD + DEL` would publish every member N times. Remove in the next minor.
 *
 * KEYS[1] = main stream topic, KEYS[2] = retry ZSET key
 * ARGV[1] = now epoch ms, ARGV[2] = max entries to drain per call
 * Returns the number of entries moved.
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
 * XACK the failed entry and publish the envelope to the DLQ stream in one atomic step. The `XACK` return value is the
 * gate: 1 only for the caller that actually removed the entry from the PEL, 0 for everyone else - without it, two
 * replicas reaching the same exhausted entry in one window both write a DLQ record.
 *
 * KEYS[1] = main stream topic, KEYS[2] = DLQ stream topic (e.g. `${topic}.dlq`)
 * ARGV[1] = consumer group, ARGV[2] = entry id, ARGV[3] = envelope JSON (with meta.lastError filled in)
 */
export const DLQ_SCRIPT = `
if redis.call('XACK', KEYS[1], ARGV[1], ARGV[2]) == 1 then
  redis.call('XADD', KEYS[2], '*', 'data', ARGV[3])
  return 1
end
return 0
`
