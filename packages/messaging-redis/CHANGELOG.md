# @miiajs/messaging-redis

## 0.8.0

### Minor Changes

- [`0481c5c`](https://github.com/miiajs/miia/commit/0481c5c596509a93090c46dc57a6d8a5b078dd0e) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Give every process its own broadcast group

  Broadcast groups now end in `<hostname>_<pid>_<token>`, with a random token drawn once per process, where they ended in
  `<hostname>_<pid>`. Replicas that share hostname and pid - host-network containers that all run as pid 1 - derived the
  same group, split its copies between them, and the first to shut down destroyed it for the others. Each now gets its
  own group and its own copy of every message. The token is kept on `globalThis`, so two copies of `@miiajs/messaging`
  in one process agree on it.

  The Redis transport reads the owner off each broadcast group's name instead of computing it, so its liveness key always
  matches the group the bus formed, and its orphan cleanup recognises both shapes: groups left by releases before the
  token are still removed once their owner is gone. A broadcast group subscribed directly under a name without that
  suffix gets no liveness key and no orphan cleanup.

- [`f513194`](https://github.com/miiajs/miia/commit/f5131942f31a0493790b6e7981b162133f969e2d) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add `initialPosition` to choose where a new subscription starts reading

  A consumer group created after entries were published never saw them: every group started at the end of the topic,
  so a message published before a worker's first start, or before a new handler was deployed, was not delivered. That
  stays the default, and it is now a choice per handler with a written contract.

  `@On(topic, { initialPosition })` sets it per handler, `MessagingModule.configure({ initialPosition })` sets a bus
  default. Values:

  - `'latest'` - only entries published after the group is created. Default, no behaviour change.
  - `'earliest'` - everything the broker still retains for the topic.
  - `{ since: ms }` - entries from the last `since` milliseconds, plus everything after. `since` must be a positive
    integer.

  The position applies only when the broker-side group is created for the first time; an existing group is never moved.
  Broadcast handlers always start at `'latest'` - the bus default does not reach them, and an explicit `'earliest'` or
  `{ since }` on one throws at startup. Handlers on one bus that share an explicit `group` must resolve to the same
  position, or startup throws.

  **Transport contract.** `MessageTransport` gains an optional `supportedInitialPositions`, validated at startup like
  `supportedModes`. A transport that does not declare it supports `'latest'` only, so a handler asking for more fails at
  startup instead of silently starting at the end. `InMemoryTransport` declares all three - it retains nothing, so each
  means "from now".

  **Redis.** `XGROUP CREATE` starts at `$` for `'latest'`, `0` for `'earliest'`, and `<TIME - since>-0` for a window,
  measured on the Redis clock (the process clock only when `TIME` is denied, with one warning). Creating a group now logs
  `Created consumer group <group> on <topic> at <id>`.

- [`092712b`](https://github.com/miiajs/miia/commit/092712b2ffbf01f2b0fbd8b11286934d516a0754) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Require ioredis 6

  The peer dependency moves to `ioredis@^6`. Connections speak RESP3; ioredis falls back to RESP2 only when the server
  answers `HELLO 3` with NOPROTO or an unknown-command error - behind a proxy that refuses it otherwise, pass a `client`
  built with `protocol: 2`. Replies are read in ioredis' default `replyMapping: 'legacy'` shapes, and a client created
  with `replyMapping: 'resp3'` is rejected. Clients the transport creates now use ioredis 6's reconnect backoff
  (exponential, capped at 5s with jitter, was linear up to 2s).

- [`3868e0b`](https://github.com/miiajs/miia/commit/3868e0b414d6e5ce94379cb716ab1657a19a969d) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Require Redis 7.2 or newer

  The supported minimum is now Redis 7.2. Valkey works and is part of the test matrix. `onInit()` reads the server
  version with `HELLO` and logs a warning on anything older - the transport still starts. The 6.2-only path that acked
  pending entries trimmed out of the stream is gone.

- [`8edc272`](https://github.com/miiajs/miia/commit/8edc272110200edac6b43488d2f937237e136d09) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Drop and reconnect Redis connections that stop answering

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

- [`4f46847`](https://github.com/miiajs/miia/commit/4f46847af824579e75e3f1f673abd51a88891eeb) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Remove the `retrySchedulerIntervalMs` and `reclaimIntervalMs` options

  Both have been deprecated aliases of `retryIntervalMs` since 0.7.0 and are no longer read. Use `retryIntervalMs`.

- [`ab8fa94`](https://github.com/miiajs/miia/commit/ab8fa946664bb5c81b18d2c84ba95f4fc1078479) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Remove the transitional drain of the pre-0.7 retry sorted set

  0.7.0 moved retries onto the consumer group PEL and kept draining the old `<topic>:retry` sorted set back into the
  stream for rolling deploys from 0.6. The transport no longer reads that key, which also drops one Lua call per topic
  every 10-60s from every process.

### Patch Changes

- [`3605783`](https://github.com/miiajs/miia/commit/36057838dc0fd20440c15cf84e306db8bb844953) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Stop broadcast orphan cleanup from destroying live siblings

  Orphan cleanup took every broadcast group of the same handler on the same host with another pid for a dead previous
  incarnation. On a host running several live processes (a PM2 cluster, several workers per container), each subscribe
  destroyed its siblings' live broadcast groups. Orphans left by crashed replicas on other hosts were never cleaned up.

  A process with broadcast subscriptions now keeps a liveness key, `miia:messaging:alive:<hostname>_<pid>_<token>`
  (`PX 30000`, refreshed every 10s, never deleted - it expires). On subscribe, and once more about 40s later, a broadcast
  group of the same handler is removed only when its owner's key has expired, whatever host it came from. Live siblings
  are left alone, and crashed replicas' orphans go away shortly after a replacement starts, wherever it lands.

  **ACL.** The publisher client needs `SET` and `EXISTS` on `~miia:messaging:alive:*`. When `SET` is denied, the
  transport logs one warning and turns off liveness and orphan cleanup.

  **Rolling upgrade.** Older replicas write no liveness key, so new replicas remove their broadcast groups on start, and
  the old replicas, which cannot recreate a group, stop receiving broadcasts until they are replaced.

- [`f4ff16d`](https://github.com/miiajs/miia/commit/f4ff16d633d367a6e9b23467310915d84606e984) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Drop a stream entry whose `data` is JSON but not a message envelope

  An entry like `{}` or `null` (a hand-written `XADD`, another producer on the same stream) threw past the parse guard,
  stayed pending and came back once per retry horizon forever without reaching the DLQ, failing that group's retry sweep
  each time once its budget ran out. It is now acked and logged the way unparseable JSON already was.

- [`3605783`](https://github.com/miiajs/miia/commit/36057838dc0fd20440c15cf84e306db8bb844953) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Recover consumer lanes when their group disappears

  A lane whose consumer group or stream vanished under it - Redis restarted without persistence, `FLUSHALL`, the key
  evicted, a manual `DEL` or `XGROUP DESTROY` - logged one warning and stopped reading for good, on every replica, until
  the process restarted. It now recreates the group and keeps reading.

  The group is recreated at the highest position the process knows for it: where the group stood when the process
  subscribed, or the last entry it has read since. The subscription's `initialPosition` applies only when that is
  unknown. Entries other replicas consumed past that point are delivered again - `@Idempotent` covers them. Entries in
  flight at that moment lose their retry state, and retries parked in a destroyed group are gone.

  A lane notices a deletion at once.

  Deleting a stream or a group under live consumers no longer sticks: `MKSTREAM` brings the stream back and the group is
  recreated. Stop the consumers first; move a group with `XGROUP SETID`.

- [`8befc2b`](https://github.com/miiajs/miia/commit/8befc2bc7110cf6809c793d3494910f2c915e3fa) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Log Redis connection errors through the transport logger

  The clients the transport creates - the `url` form's client and every consumer lane - had no `error` listener, so
  ioredis printed an `[ioredis] Unhandled error event` stack from every client on every reconnect attempt. Their
  connection errors now go through the transport logger: one `Redis connection error` line when the failures start, then
  at most one a minute unless the cause changes, and a `Redis connection recovered` line when they stop, with the count
  after more than one. A refused `localhost`, which ioredis reports with an empty message, is logged with its code and
  the address of every attempt. A `client` you pass gets no listener from the transport and keeps its own.

  `redisIdempotencyStore({ url })` logs the first connection error of an outage, and a recovery line with the error count
  once the connection is back after more than one.

- [`36d1f60`](https://github.com/miiajs/miia/commit/36d1f6056e2e19e7fec5d26c25ebc7a43693bdc9) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Lower the runtime floors to what the packages need.

  Node moves from `24.18.1` to `22.12.0`. Nothing in the packages needs Node 24. 22.12.0 is the first
  22.x release where `require(esm)` is on by default, so CommonJS code can `require()` these ESM-only
  packages, and it is the floor `papr@17` declares. The old floor tracked the 24.17.0 and 24.18.1
  security releases; `engines` cannot enforce a patch level, so that advice now lives in `SECURITY.md`.

  Deno moves from `2.6.1` to `2.0.0`, with two exceptions. Projects that `@miiajs/cli` runs on Deno
  need 2.4.0, the first release with the `--sloppy-imports` flag the CLI passes. `@miiajs/serve-static`
  needs 2.5.0: on 2.0 through 2.4 Deno's `Readable.toWeb` throws an uncaught error once a file has been
  sent and takes the process down.

  `@miiajs/uws-server` now declares Node.js 22, 24 and 26 only, with no Bun or Deno range:
  uWebSockets.js ships binaries for those three lines and never loaded anywhere else.
  `@miiajs/node-server` drops its Deno range: Deno apps listen through `Deno.serve` and never need the
  adapter, and it is not tested there.

  Bun stays at `1.4.0`.

  The documented TypeScript requirement moves from 5.7 to 6.0. The `ES2025` target that the docs and
  `miia new` use does not exist before TypeScript 6.0, so 5.7 through 5.9 never worked with that setup.

- Updated dependencies [[`0481c5c`](https://github.com/miiajs/miia/commit/0481c5c596509a93090c46dc57a6d8a5b078dd0e), [`f513194`](https://github.com/miiajs/miia/commit/f5131942f31a0493790b6e7981b162133f969e2d), [`36d1f60`](https://github.com/miiajs/miia/commit/36d1f6056e2e19e7fec5d26c25ebc7a43693bdc9)]:
  - @miiajs/messaging@0.8.0

## 0.7.0

### Minor Changes

- [`9c80fb6`](https://github.com/miiajs/miia/commit/9c80fb6dfa8315f3f6390ada26a85b88e28e3450) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Move retry onto the consumer group PEL

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

### Patch Changes

- Updated dependencies [[`1d9fd9f`](https://github.com/miiajs/miia/commit/1d9fd9f1418170c6db0337640e8b27d3b2bce010)]:
  - @miiajs/messaging@0.7.0

## 0.6.1

### Patch Changes

- [`903847a`](https://github.com/miiajs/miia/commit/903847adcbf2b69920fb3ae5f6f5e199faea0a68) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Disable the idle-reclaim loop in `RedisStreamsTransport`

  `reclaimIdle()` called `XAUTOCLAIM` and discarded its result, so it never actually redelivered a message left
  pending by a dead consumer - the reclaim path recovered nothing. It did mutate Redis state though: reassigning
  PEL ownership, incrementing delivery counts and resetting idle times. It is now disabled outright.

  This is a required upgrade step before the next release, which replaces the retry subsystem with a PEL-based
  mechanism that reads exactly those delivery counts and idle times. A 0.6.0 replica still running its old reclaim
  loop during a rolling deploy would corrupt the new replicas' retry state, so upgrade every replica to this
  version first.

  `reclaimIntervalMs` and `minIdleMs` are still accepted but have no effect in this version.

- Updated dependencies []:
  - @miiajs/messaging@0.6.1

## 0.6.0

### Minor Changes

- [`fafb103`](https://github.com/miiajs/miia/commit/fafb1036bb5e7658fd7971d380e321c0e080798e) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Raise the Bun floor from `1.3.11` to `1.4.0`.

  Bun 1.4 makes `Bun.serve` pause a `ReadableStream` request body when the consumer stops draining it, so
  a stalled handler now holds the client back instead of letting the runtime buffer the upload. That is
  what the streaming contract in `@miiajs/multipart` describes, and on 1.3 it was only true of Deno and
  `@miiajs/node-server`.

  Two further behaviours were measured as fixed on 1.4.0 but are not part of Bun's published release
  notes, so treat them as observations rather than guarantees: `maxRequestBodySize` now also rejects a
  body sent without a `Content-Length`, and a connection survives a response written before the request
  body was drained - on 1.3 the next request on that connection came back as an empty `400`.

  The `Readable.fromWeb` workaround the multipart docs carried is gone with the floor: on 1.3.12 it never
  settled once the web stream errored, and on 1.4.0 it rejects like Node does.

- [`44f697d`](https://github.com/miiajs/miia/commit/44f697dd16deaf58c8af37269405ac961967c76f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Raise the Node floor from `22.22.1` to `24.18.1`.

  The floor lands on that release rather than on `24.0.0` because 24.17.0 and 24.18.1 were both security
  releases, and what they fix is what a framework that is itself an HTTP server runs on: hostname
  normalization for TLS server identity checks, two high-severity http2 fixes covering header memory
  retention in session accounting and a deferred rst stream, response queue poisoning in `http.Agent`,
  and a refusal for requests that exceed the maximum header count. 24.18.1 also carries llhttp 9.4.3 and
  undici 7.29.0.

  The 24 line itself marks `require(esm)` and the module compile cache stable and raises the default
  `Buffer.poolSize` to 64 KiB.

  `@miiajs/uws-server` is unaffected by the move: uWebSockets.js 20.69.0 ships a `137` binary, so Node 24
  already loaded it.

  Types stay on `@types/node@^24.13.3`, which is where DefinitelyTyped ended the 24 line. The APIs added
  in 24.16 through 24.19 - `req.signal` on `IncomingMessage`, the `httpValidation` server option,
  `blob.textStream()` - are there at runtime but carry no type definitions yet.

### Patch Changes

- Updated dependencies [[`fafb103`](https://github.com/miiajs/miia/commit/fafb1036bb5e7658fd7971d380e321c0e080798e), [`44f697d`](https://github.com/miiajs/miia/commit/44f697dd16deaf58c8af37269405ac961967c76f)]:
  - @miiajs/messaging@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @miiajs/messaging@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @miiajs/messaging@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @miiajs/messaging@0.3.0

## 0.2.0

### Patch Changes

- [`7ccf372`](https://github.com/miiajs/miia/commit/7ccf3729590c8446eec61d2fb55320f69bca5c26) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Auto-install internal implementation dependencies.

  `@miiajs/swagger` requires `@miiajs/serve-static` to serve the Swagger UI bundle, and `@miiajs/messaging-redis` requires `@miiajs/messaging` as the abstract bus it implements a transport for. In `0.1.1` these were declared as `peerDependencies`, which meant `bun add @miiajs/swagger` did not install `@miiajs/serve-static` automatically and the consumer had to know about it and add it manually.

  Move both back to `dependencies` (as plain semver `^0.2.0`, not `workspace:` - the workspace protocol would still leak into the published package). `@miiajs/core` stays a `peerDependency` because it is the framework root and a single instance must be shared across all plugins.

- Updated dependencies:
  - @miiajs/core@0.2.0
  - @miiajs/messaging@0.2.0

## 0.1.1

### Patch Changes

- [`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Fix `workspace:*` leaking into published packages.

  The `0.1.0` release published `"@miiajs/core": "workspace:*"` (and other internal `@miiajs/*` deps) into the npm registry, causing `yarn add @miiajs/<pkg>` to fail with `Couldn't find any versions for @miiajs/core that matches workspace:*`. `changeset publish` invokes `npm publish` under the hood, and npm does not resolve the workspace protocol when the lockfile is `bun.lock`.

  Internal `@miiajs/*` dependencies are now declared as `peerDependencies` (`^0.1.0`, plain semver) plus `devDependencies` (`workspace:*` for local linking). This is the canonical pattern for framework plugins (NestJS-style):

  - Guarantees a single `@miiajs/core` instance in the consumer's `node_modules` (required for DI and decorator metadata to work).
  - Lets the consumer control the `@miiajs/core` version they install.
  - Eliminates `workspace:*` from the published `package.json` `dependencies`.

  Affected packages: `auth`, `config`, `drizzle`, `jwt`, `messaging`, `messaging-redis`, `mongoose`, `papr`, `serve-static`, `swagger`.

- Updated dependencies [[`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee), [`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee)]:
  - @miiajs/core@0.1.1
  - @miiajs/messaging@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [[`bf9132d`](https://github.com/miiajs/miia/commit/bf9132d16ee802cf1880a61ffd6fa018ee4d9e89)]:
  - @miiajs/core@0.1.0
  - @miiajs/messaging@0.1.0
