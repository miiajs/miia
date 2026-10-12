---
'@miiajs/messaging-redis': patch
---

Log Redis connection errors through the transport logger

The clients the transport creates - the `url` form's client and every consumer lane - had no `error` listener, so
ioredis printed an `[ioredis] Unhandled error event` stack from every client on every reconnect attempt. Their
connection errors now go through the transport logger: one `Redis connection error` line when the failures start, then
at most one a minute unless the cause changes, and a `Redis connection recovered` line when they stop, with the count
after more than one. A refused `localhost`, which ioredis reports with an empty message, is logged with its code and
the address of every attempt. A `client` you pass gets no listener from the transport and keeps its own.

`redisIdempotencyStore({ url })` logs the first connection error of an outage, and a recovery line with the error count
once the connection is back after more than one.
