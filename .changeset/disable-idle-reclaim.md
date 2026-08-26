---
'@miiajs/messaging-redis': patch
---

Disable the idle-reclaim loop in `RedisStreamsTransport`

`reclaimIdle()` called `XAUTOCLAIM` and discarded its result, so it never actually redelivered a message left
pending by a dead consumer - the reclaim path recovered nothing. It did mutate Redis state though: reassigning
PEL ownership, incrementing delivery counts and resetting idle times. It is now disabled outright.

This is a required upgrade step before the next release, which replaces the retry subsystem with a PEL-based
mechanism that reads exactly those delivery counts and idle times. A 0.6.0 replica still running its old reclaim
loop during a rolling deploy would corrupt the new replicas' retry state, so upgrade every replica to this
version first.

`reclaimIntervalMs` and `minIdleMs` are still accepted but have no effect in this version.
