---
'@miiajs/messaging-redis': minor
---

Require ioredis 6

The peer dependency moves to `ioredis@^6`. Connections speak RESP3; ioredis falls back to RESP2 only when the server
answers `HELLO 3` with NOPROTO or an unknown-command error - behind a proxy that refuses it otherwise, pass a `client`
built with `protocol: 2`. Replies are read in ioredis' default `replyMapping: 'legacy'` shapes, and a client created
with `replyMapping: 'resp3'` is rejected. Clients the transport creates now use ioredis 6's reconnect backoff
(exponential, capped at 5s with jitter, was linear up to 2s).
