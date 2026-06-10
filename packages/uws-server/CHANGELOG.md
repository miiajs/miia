# @miiajs/uws-server

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
