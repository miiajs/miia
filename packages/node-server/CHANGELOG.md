# @miiajs/node-server

## 0.7.0

## 0.6.1

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

- [`0502f5f`](https://github.com/miiajs/miia/commit/0502f5fa193c83c384b284249a0a4d6572a47c36) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Send `Connection: close` when the handler answers without reading the request body.

  Unread bytes are still on the socket, so the connection cannot carry another request - RFC 9112
  section 9.6 says so plainly. Node kept advertising keep-alive and then tore the socket down anyway,
  which stranded whatever a pooled client sent next: the following request came back as a closed
  socket rather than a response. It surfaced against Bun 1.4's fetch, whose connection pool is
  stricter than 1.3's; curl had been papering over it by opening a fresh connection.

  The check needs `hasBody` as well as the stream flags, because a GET with nothing to read reports
  `readableEnded` and `complete` as false too. A GET, a 404, and a POST whose body the handler drained
  all keep keep-alive as before.

  This is the same rule `send413` already followed for the early payload rejection; it now covers the
  ordinary response path in both optimized and native mode.

## 0.5.0

## 0.4.0

## 0.3.0

### Minor Changes

- [`cdb17d8`](https://github.com/miiajs/miia/commit/cdb17d8fe4612fdf0f803ff197bf6cdc7cfe5675) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add `@miiajs/rate-limit`: fixed-window rate limiting with a guard flow and a perimeter middleware.

  The primary path is the guard flow: `RateLimitModule.configure({ limit, window })` plus
  `app.useGuard(RateLimitGuard)` for app-wide enforcement, with `@RateLimit(policy)` and
  `@SkipRateLimit()` for per-route control. `@RateLimit` uses replacement semantics, the same
  precedence as `@BodyLimit` (method > class > global) - a decorated route keeps its own bucket
  and does not consume the global quota; `@SkipRateLimit()` disables limiting on its scope. The
  `rateLimit()` middleware is the perimeter form: standalone (no DI) and the only layer that
  covers unmatched routes (404s). Both wrap the same `RateLimiter` core (Upstash-style
  `limit(key)` result object), share a pluggable `RateLimitStore` contract whose `increment()`
  counts the hit and decides blocking atomically (ready for a future Redis Lua store), ship an
  in-memory `MemoryStore`, support `blockDuration` bans, and emit draft-6 `RateLimit-*` headers
  (`legacy` / `false` modes available) with `Retry-After` on 429.

  `blockDuration` also supports optional geometric backoff: `blockBackoff` grows the ban per repeat
  offence (`blockDuration`, `blockDuration × blockBackoff`, ...) up to `maxBlockDuration`, with strikes
  that reset after a `strikeReset` grace period measured from the end of the block. It is opt-in
  (`blockBackoff` defaults to `1`); values above `1` require `maxBlockDuration` to bound escalation.

  To support client keying, `@miiajs/core` gains `ctx.conn` (`ConnInfo` - lazy transport-level
  connection info) and `ctx.ip`, plus a `trustProxy: boolean | string | string[]` app option
  (leftmost `X-Forwarded-For`, a vendor header like `cf-connecting-ip`, or a priority list).
  `@miiajs/node-server` and `@miiajs/uws-server` populate the client address in both optimized
  and native modes. Core also adds `TooManyRequestsException` (429) and a `ip` option on
  `TestApp.request()` for faking the client address in tests.

## 0.2.0

### Minor Changes

- [`7ab341f`](https://github.com/miiajs/miia/commit/7ab341fdcb913253e6be412566aac66e375ad27b) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add framework-level request body size limits.

  `new Miia({ maxBodySize })` (default 1 MiB, `false` to disable) plus a dual class/method
  `@BodyLimit(bytes)` decorator (method > class > app default), enforced via a new
  `PayloadTooLargeException` (413). Limits are resolved into the route table at registration
  time (zero metadata lookups at runtime); declared Content-Length is checked in core after
  route matching, and chunked bodies are capped at the adapter level: Bun via
  `maxRequestBodySize`, Deno via a counting stream wrapper, and `@miiajs/node-server` /
  `@miiajs/uws-server` via a new `maxBodySize` option (early 413 on Content-Length,
  in-stream byte cap for chunked bodies that rejects with an Error named
  `'PayloadTooLargeError'`, mapped to 413 by core).

  Note: standalone `serve()` from the server adapters now defaults to a 1 MiB body cap;
  pass `maxBodySize: false` to restore the old unlimited behavior.

## 0.1.1

## 0.1.0
