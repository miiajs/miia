# @miiajs/uws-server

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
