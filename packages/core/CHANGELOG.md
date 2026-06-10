# @miiajs/core

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

### Patch Changes

- [`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Internal: switch `RequestContext` to a class-based shape for V8 hidden-class stability.

  `createContext()` previously allocated a plain object literal per request, which created 7 new closures per request (`query`/`rawQuery` getter/setter pairs plus `json`/`text`/`_setBody` methods). The new `Context` class places those methods on the prototype and uses fixed instance fields, giving V8 a deterministic hidden class to inline-cache against. Public API is unchanged - same `RequestContext` interface, same `json`/`text` caching semantics, same support for custom property attachment (`ctx.user`, `ctx.requestId`, etc.).

## 0.1.0

### Minor Changes

- [`bf9132d`](https://github.com/miiajs/miia/commit/bf9132d16ee802cf1880a61ffd6fa018ee4d9e89) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Initial public release of the MiiaJS framework.
