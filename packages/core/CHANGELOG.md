# @miiajs/core

## 0.1.1

### Patch Changes

- [`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Internal: switch `RequestContext` to a class-based shape for V8 hidden-class stability.

  `createContext()` previously allocated a plain object literal per request, which created 7 new closures per request (`query`/`rawQuery` getter/setter pairs plus `json`/`text`/`_setBody` methods). The new `Context` class places those methods on the prototype and uses fixed instance fields, giving V8 a deterministic hidden class to inline-cache against. Public API is unchanged - same `RequestContext` interface, same `json`/`text` caching semantics, same support for custom property attachment (`ctx.user`, `ctx.requestId`, etc.).

## 0.1.0

### Minor Changes

- [`bf9132d`](https://github.com/miiajs/miia/commit/bf9132d16ee802cf1880a61ffd6fa018ee4d9e89) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Initial public release of the MiiaJS framework.
