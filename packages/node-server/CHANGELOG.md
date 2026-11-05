# @miiajs/node-server

## 0.9.0

### Patch Changes

- [`fedece7`](https://github.com/miiajs/miia/commit/fedece71c1108aa2ec31e2fae0f48b9ea964363f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - In `mode: 'optimized'` the request body is read once, as from a real `Request` (and as in `mode: 'native'`, on Bun and on Deno). Once `ctx.json()`/`ctx.text()` or any of `ctx.req.json()`/`text()`/`arrayBuffer()`/`bytes()`/`blob()`/`formData()` has taken the body, or `ctx.req.body` has been read, the next consumer rejects with `TypeError: Body is unusable: Body has already been read`, `ctx.req.clone()` throws `TypeError: unusable` as Node's own `Request` does, a `ctx.req.body` stream is locked, and `ctx.req.bodyUsed` is `true`. Before, a small body with a Content-Length (the buffered path) could be read again, or cloned after it was read, so the escape hatch after the helpers returned the body a second time instead of throwing as documented. `ctx.req.bytes()`, which the request lacked in this mode, is there now and reads the body the same way. On uws-server a stream read through `ctx.req.body` now also counts in `bodyUsed`. `ctx.json()` and `ctx.text()` still share one read.

- [`fedece7`](https://github.com/miiajs/miia/commit/fedece71c1108aa2ec31e2fae0f48b9ea964363f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A request whose `Host` header makes no valid URL (`Host: x:99999`, `Host: [::1`) is served, as on Bun and Deno. `new Request()` refused the URL built from that header, so in `mode: 'optimized'` reading a streamed body (chunked, or over `bufferThreshold`) failed, and in `mode: 'native'` node-server answered every such request with a 500 while uws-server threw out of its request handler and took the process down. The request is now built on `http://localhost` and its own path when the header makes no URL: `ctx.req.url` keeps the header as it came in `mode: 'optimized'`, and is `http://localhost/...` in `mode: 'native'`, where it must parse.

  In `mode: 'native'` the `Host` header can no longer move a request to another route either. The URL was built by putting the header in front of the request target, so `GET /public` with `Host: x/admin` reached `/admin/public`, and a query, a fragment or a backslash in the header moved it too. Only a `Host` that is `host[:port]` or `[IPv6]:port` goes into the URL now; any other is replaced with `localhost`, and on node-server an empty one with the address the server listens on, as on uws-server. `mode: 'optimized'` routes by the request target alone and was not affected.

- [`fedece7`](https://github.com/miiajs/miia/commit/fedece71c1108aa2ec31e2fae0f48b9ea964363f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - In `mode: 'native'` a request whose method a `Request` cannot carry is answered by the adapter without reaching the app: `TRACE`, `TRACK` and `CONNECT`, which fetch forbids, get a `501`, and a method that is not a valid token gets a `400`. Before, uws-server threw out of its request handler and took the process down, and node-server logged an unhandled error and answered `500` (Node's own parser already answers `TRACK` and passes `CONNECT` to the `connect` event). A body that came with the request is dropped. `mode: 'optimized'` keeps handing these methods to the app, as Bun and Deno do.

- [`fe2b0dd`](https://github.com/miiajs/miia/commit/fe2b0ddfe9fe832f5309e53505fa3c9dacfc472f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Cancelling a streamed request body no longer ends the process. `ctx.req.body.cancel()`, or cancelling a `pipeThrough` of it or a reader on it, could throw an uncaught `ERR_INVALID_STATE: Controller is already closed` from `Readable.toWeb` with upload data buffered, and otherwise left the connection unable to carry another request: the rest of the body was never read, while the response advertised keep-alive. A cancel now only stops reading the body. The response the handler returns goes out on the connection as usual, the rest of the body is drained after it (500 ms, 64 MB, as for the early 413), and the next request is answered on the same connection, or the connection is closed if the client has not finished by then. The body stream no longer comes from `Readable.toWeb`; a body read to the end, or failing on a client that went away, behaves as before.

- [`fedece7`](https://github.com/miiajs/miia/commit/fedece71c1108aa2ec31e2fae0f48b9ea964363f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A client uploading a body whose declared `Content-Length` is over `maxBodySize` gets its `413`. The answer said `Connection: close`, so Node destroyed the socket as soon as it was written, with the upload still arriving, and that resets the connection: the `413` was lost to up to a third of `fetch` and a tenth of `node:http` uploads of 64 MB, and to about half of plain uploads that do not read the answer before they finish (measured on Node). The `413` now keeps the connection (and goes out under a `Content-Length` instead of chunked) while the adapter reads and drops the rest of the body, as it already did, for at most 500 ms and 64 MB: a body that gets through in that time leaves the connection ready for the next request, anything longer has it destroyed. A client that sends no body is let go after the 500 ms, and such a connection can hold `close()` that long. Both modes.

## 0.8.0

### Patch Changes

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
