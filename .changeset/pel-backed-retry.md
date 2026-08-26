---
'@miiajs/messaging-redis': minor
---

Move retry onto the consumer group PEL

Retry no longer acks a nacked entry and re-publishes it through a shared `${topic}:retry` ZSET. The entry stays
pending in the PEL of the group that owns it and is re-parked with `XCLAIM ... IDLE <horizon - backoff> JUSTID`, so it
resurfaces one backoff later and only for that group. One housekeeping pass per `retryIntervalMs` sweeps
`XPENDING ... IDLE <horizon>`, claims what is due, and redelivers it.

This fixes three defects that shared a single root cause:

- **Messages left pending by a dead consumer were never recovered.** `reclaimIdle()` ran `XAUTOCLAIM` and discarded
  the result, so nothing was ever redelivered and nothing reached the DLQ.
- **The attempt counter did not advance across a crash.** `meta.attempt` moved only on an explicit nack, so a message
  that killed the process could never exhaust its attempts.
- **A retry in one consumer group was duplicated to every other group on the topic.** The drained envelope went back
  via `XADD`, which every group on that stream reads. Since each `@On` handler derives its own group, any topic with
  more than one handler was affected on every retry.

Retry and crash recovery are now one mechanism: a retry whose backoff has elapsed and an entry whose consumer died
are indistinguishable to the sweep. The attempt counter of record is the PEL delivery count, so it survives the
process. A handler that outlives the horizon is protected by a heartbeat that renews its entries every `horizon / 2`.

**Upgrade sequence.** Roll every replica to 0.6.1 before deploying this release. 0.6.0's reclaim loop rewrites the PEL
state this version depends on, and a mixed deployment can push an entry to the DLQ that had only failed once.

**Options.** `retrySchedulerIntervalMs` and `reclaimIntervalMs` are deprecated aliases of the new `retryIntervalMs`
(default 1000; the reclaim loop previously ran at 30000). Precedence is
`retryIntervalMs` > `retrySchedulerIntervalMs` > `reclaimIntervalMs`. `minIdleMs` is now the floor of a horizon
computed from the retry config.

**Redis 6.2 is the hard minimum** (`XPENDING ... IDLE` and exclusive `(<id>` cursors), 7.0 or newer recommended.

**Stream retention is now load-bearing.** A retry lives in the stream entry itself, so a `MAXLEN`/`MINID` cap or an
`XTRIM` that cuts a still-pending entry destroys the payload. Size retention above your longest retry chain. The old
ZSET held an independent copy of the envelope and had no such exposure.

Entries left in a legacy `${topic}:retry` ZSET by a previous version are drained back into the stream once per topic
on `subscribe()` and then on a slow schedule of its own (10s, doubling to a 60s ceiling while the key stays empty,
back to the retry cadence as soon as an entry moves), so nothing scheduled during a rolling deploy is stranded. That
drain is transitional and will be removed in a later minor.
