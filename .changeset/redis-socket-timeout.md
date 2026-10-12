---
'@miiajs/messaging-redis': minor
---

Drop and reconnect Redis connections that stop answering

New `socketTimeoutMs` option, default 10s. A connection that stops answering - a half-open socket after a network
partition, a proxy that accepted and went silent - is dropped once it has been silent that long with a command
outstanding, then reconnected, and its commands are resent, where a blocked lane or the publisher used to hang for good.
Lanes get `blockMs` on top, and none with `blockMs: 0`, which blocks forever. `0` turns it off, and a `client` you pass
is left as it is. A value `setTimeout` cannot hold throws at construction.

Startup now fails with the real cause, `Could not connect to Redis: <cause>`, instead of hanging on a silent server or
reporting `Connection is closed.`, and a failed connect, at startup or for a new lane, no longer leaves the client
reconnecting in the background.

A resent `XADD` whose reply was lost can append the entry twice: publishing is at-least-once, and `@Idempotent` covers
consumers.

`redisIdempotencyStore({ url })` takes the same `socketTimeoutMs`, so a half-open store connection no longer stalls
every `@Idempotent` handler.
