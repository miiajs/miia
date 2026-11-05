# @miiajs/uws-server

## 0.9.0

### Patch Changes

- [`fedece7`](https://github.com/miiajs/miia/commit/fedece71c1108aa2ec31e2fae0f48b9ea964363f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - In `mode: 'optimized'` the request body is read once, as from a real `Request` (and as in `mode: 'native'`, on Bun and on Deno). Once `ctx.json()`/`ctx.text()` or any of `ctx.req.json()`/`text()`/`arrayBuffer()`/`bytes()`/`blob()`/`formData()` has taken the body, or `ctx.req.body` has been read, the next consumer rejects with `TypeError: Body is unusable: Body has already been read`, `ctx.req.clone()` throws `TypeError: unusable` as Node's own `Request` does, a `ctx.req.body` stream is locked, and `ctx.req.bodyUsed` is `true`. Before, a small body with a Content-Length (the buffered path) could be read again, or cloned after it was read, so the escape hatch after the helpers returned the body a second time instead of throwing as documented. `ctx.req.bytes()`, which the request lacked in this mode, is there now and reads the body the same way. On uws-server a stream read through `ctx.req.body` now also counts in `bodyUsed`. `ctx.json()` and `ctx.text()` still share one read.

- [`fedece7`](https://github.com/miiajs/miia/commit/fedece71c1108aa2ec31e2fae0f48b9ea964363f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A request whose `Host` header makes no valid URL (`Host: x:99999`, `Host: [::1`) is served, as on Bun and Deno. `new Request()` refused the URL built from that header, so in `mode: 'optimized'` reading a streamed body (chunked, or over `bufferThreshold`) failed, and in `mode: 'native'` node-server answered every such request with a 500 while uws-server threw out of its request handler and took the process down. The request is now built on `http://localhost` and its own path when the header makes no URL: `ctx.req.url` keeps the header as it came in `mode: 'optimized'`, and is `http://localhost/...` in `mode: 'native'`, where it must parse.

  In `mode: 'native'` the `Host` header can no longer move a request to another route either. The URL was built by putting the header in front of the request target, so `GET /public` with `Host: x/admin` reached `/admin/public`, and a query, a fragment or a backslash in the header moved it too. Only a `Host` that is `host[:port]` or `[IPv6]:port` goes into the URL now; any other is replaced with `localhost`, and on node-server an empty one with the address the server listens on, as on uws-server. `mode: 'optimized'` routes by the request target alone and was not affected.

- [`fedece7`](https://github.com/miiajs/miia/commit/fedece71c1108aa2ec31e2fae0f48b9ea964363f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - In `mode: 'native'` a request whose method a `Request` cannot carry is answered by the adapter without reaching the app: `TRACE`, `TRACK` and `CONNECT`, which fetch forbids, get a `501`, and a method that is not a valid token gets a `400`. Before, uws-server threw out of its request handler and took the process down, and node-server logged an unhandled error and answered `500` (Node's own parser already answers `TRACK` and passes `CONNECT` to the `connect` event). A body that came with the request is dropped. `mode: 'optimized'` keeps handing these methods to the app, as Bun and Deno do.

- [`fedece7`](https://github.com/miiajs/miia/commit/fedece71c1108aa2ec31e2fae0f48b9ea964363f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - The `413` for a declared `Content-Length` over `maxBodySize` says `Connection: close`. The connection cannot carry another request until the declared body is through, and before, a client that reused it had its next request taken for part of that body. uWS still discards the body, and the client closes the connection as told; one that sent only the headers and keeps the connection open is closed by uWS's idle timeout, about 10 s.

- [`fedece7`](https://github.com/miiajs/miia/commit/fedece71c1108aa2ec31e2fae0f48b9ea964363f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A response that declares its own `Content-Length` goes out with exactly one framing header. The adapter no longer forwards `content-length` or `transfer-encoding` to uWS, which frames every response itself: a body in memory gets uWS's own `Content-Length` instead of a duplicate, a HEAD answer or a 304 without a body (serve-static's HEAD included) reports the declared length as its `Content-Length` and keeps uWS's idle timeout for the connection, a HEAD answer that declares none gets no `Content-Length`, a 204 gets none at all (RFC 9110 forbids it there), any other response without a body is an empty one with `Content-Length: 0` instead of a declared length nothing follows, and a streamed body with a declared length (serve-static files) goes out through `tryEnd()` under that one `Content-Length`, paced by backpressure, instead of `Content-Length` next to `Transfer-Encoding: chunked`. A stream that turns out shorter or longer than declared, or errors, closes the connection rather than ending a wrong frame. A streamed body without a declared length stays chunked and goes out at the pace of the client; a source that errors closes the connection there too, rather than ending the chunked body as if it were complete, and a client that goes away cancels the source at once, even while the source has nothing to send, so a server-sent events producer that has gone quiet stops too. While a response waits for a slow client the socket keeps reading, and a request body nobody reads is given up once more than twice `bodyHighWaterMark` of it has piled up. A response that fails halfway through being written (`fetch` resolving to something that is not a `Response`) closes the connection instead of leaving the client waiting.

- [`fedece7`](https://github.com/miiajs/miia/commit/fedece71c1108aa2ec31e2fae0f48b9ea964363f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `close()` on the handle waits for the requests in flight. It stops listening, then resolves once every request that has started has its response out, a streamed one included, or has lost its client; a request that arrives on a kept-alive connection meanwhile is served and waited for too. After that it closes every connection left, so nothing is served once it has resolved. A streamed body goes out in pieces that wait for the socket, so a large streamed response is not cut off by a process that exits after `close()`; what can still sit in uWS's buffer is the end of the last piece of a stream, or what a slow client has not taken yet of a body in memory, which goes to uWS whole. An endless stream such as server-sent events holds `close()` until it ends. Before, `close()` resolved at once, so under `app.listen(port, serve)` a SIGTERM cut off a response still being produced, where node-server, Bun and Deno finish it. As with `node:http`'s `server.close()`, there is no timeout.

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

- [`6d2cbf2`](https://github.com/miiajs/miia/commit/6d2cbf200616c1e0f51509c58f2b9eb77c6aabe7) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Update uWebSockets.js to 20.70.0

  20.70.0 moves the uWS core to v20.80.0, mostly HTTP compliance fixes. The JavaScript API, the types and the binaries
  (Node.js 22, 24 and 26) are the same as in 20.69.0. 20.71.0 is skipped: its ESM entry imports `./index.js`, which the
  release does not ship, so `import('uWebSockets.js')` fails.

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

- [`56d6cf7`](https://github.com/miiajs/miia/commit/56d6cf77f18af86439080f2cc45a2337709326b8) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Apply backpressure to streamed request bodies, and add a `bodyHighWaterMark` option.

  The stream path pushed every `res.onData` chunk into the controller unconditionally, and the stream
  had no queuing strategy, so `desiredSize` counted chunks nobody looked at. A handler reading at its
  own pace never held the client back - the body simply accumulated. The stream is now built with a
  `ByteLengthQueuingStrategy`, the socket is paused with `res.pause()` once the queue passes the mark,
  and the stream's `pull()` resumes it. The buffer path for small declared bodies is untouched:
  `res.collectBody()` is bounded by `bufferThreshold` by construction.

  Measured with a slow consumer (10 ms per MB, imitating an upload to remote storage), retained bytes
  after a forced GC:

  | body    | before   | after  | `@miiajs/node-server` |
  | ------- | -------- | ------ | --------------------- |
  | 160 MB  | +302 MB  | +29 MB | +24 MB                |
  | 320 MB  | +604 MB  | +29 MB | +25 MB                |
  | 640 MB  | +1201 MB | +28 MB | +25 MB                |
  | 1280 MB | +2404 MB | +33 MB | +25 MB                |

  Before the fix that is linear at roughly 1.88x the body size. After it, memory is flat and
  independent of what the client sends: a 1.25 GB upload retains 33 MB, the same as a 160 MB one, and
  lands where node-server does. A handler that reads flat out was never the problem and is unchanged -
  under 20 MB at every size measured, before the fix as well as after. From the wire side, a handler
  stalled at 1.1 MB now holds the client to 3.3 MB where it used to accept all 64 MB on offer, which
  puts the adapter next to node-server at 2.2, Deno at 3.2 and Bun at 3.1.

  A browser-style `FormData` upload, which declares a `Content-Length` and sends flat out, behaves the
  same way - linear at about 1.96x before (+314/+630/+1254 MB at 160/320/640 MB), flat after - but
  settles on a higher plateau, around 59 MB against the streaming client's 29. More bytes are in flight
  when the pause fires, and uSockets hands over whatever it has already read. Plan capacity against the
  higher figure.

  `bodyHighWaterMark` (default `262144`, 256 KB) is how many bytes a streamed body may queue before
  the pause. Measured at 64 KB, 256 KB and 1 MB it made no difference to throughput on one 160 MB
  upload or on ten concurrent ones, so the default is the middle of a flat range rather than a tuned
  peak; very small values only buy pause/resume churn. The pause is advisory and uSockets drains the
  socket until `EWOULDBLOCK` inside one poll event, so the queue overshoots by whatever the client had
  in flight - measured 1.4 MB after a pause that fired at 16 KB. Size capacity against
  `bodyHighWaterMark` plus roughly 1.5 MB resident per in-flight upload.

  The option belongs to `serve()` and is not reachable through `app.listen(port, serve)`, which passes
  a closed set of options. Wrap the call to set it:

  ```ts
  await app.listen(3000, (info) =>
    serve({ ...info, bodyHighWaterMark: 1024 * 1024 })
  );
  ```

  **Behaviour change.** Ending the response now disposes an unread request body: the stream is
  **errored**, not closed, so a body read that was started and never awaited rejects where it used to
  resolve. `@miiajs/core` caches exactly such a promise behind `ctx.json()`, so calling it without
  awaiting and then responding produces an unhandled rejection instead of a value nobody reads. A body
  cut off mid-flight must never look complete, which is why this errors rather than closing.

  The disposal is what keeps the connection usable. A socket paused for backpressure and left paused
  after the response wedges the keep-alive connection - measured, the follow-up request gets no
  response at all. Ending with uWS's `closeConnection` flag is not the alternative: it races the
  response onto the wire and loses it about a third of the time (measured `413 | 413 | EPIPE` across
  three runs). So the remainder is resumed and discarded instead, which is bounded in memory but
  unbounded in bytes read - 511.9 MB read and dropped in 190 ms after a 413, in the worst case
  measured - with uWS's idle timeout as the only backstop. Those same bytes used to pile up in memory,
  so it is strictly better, and no `Connection: close` is needed because the body still reaches its
  end.

### Patch Changes

- [`aea5482`](https://github.com/miiajs/miia/commit/aea5482bc42223771df270bde387c0af928beb83) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Bump uWebSockets.js to v20.69.0.

  A routine move of the pin, kept separate from the backpressure work that landed alongside it so it
  can be read on its own. The adapter's API surface is unchanged: `pause()` and `resume()`, which the
  backpressure fix uses, were already there in v20.68.0, and the only addition upstream is
  `beginWrite()`, which nothing here calls.

  The install line moves with the pin - `uWebSockets.js` is fetched from GitHub, not npm, so the
  version lives in the command:

  ```sh
  bun add @miiajs/uws-server uWebSockets.js@uNetworking/uWebSockets.js#v20.69.0
  ```

  The prebuilt native binary still loads on Node 22, 24 and 26 only.

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

### Patch Changes

- [`18336b7`](https://github.com/miiajs/miia/commit/18336b7d5607df08619fc23942b61c623e660240) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Bump uWebSockets.js to v20.68.0.

  Key reason: v20.65.0 fixed a string encoding issue introduced in v20.63.0 -
  Latin-1-stored JavaScript strings could be written to the wire as non-UTF-8
  bytes, corrupting non-ASCII response bodies. v20.64.0 (the previous pin) was
  affected.

  Upstream dropped Node.js 20 and 25 support and added Node.js 26 (v20.67.0):
  the prebuilt native binary now loads on Node 22, 24 and 26 only.

## 0.1.1

## 0.1.0
