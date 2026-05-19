---
'@miiajs/core': patch
---

Internal: switch `RequestContext` to a class-based shape for V8 hidden-class stability.

`createContext()` previously allocated a plain object literal per request, which created 7 new closures per request (`query`/`rawQuery` getter/setter pairs plus `json`/`text`/`_setBody` methods). The new `Context` class places those methods on the prototype and uses fixed instance fields, giving V8 a deterministic hidden class to inline-cache against. Public API is unchanged - same `RequestContext` interface, same `json`/`text` caching semantics, same support for custom property attachment (`ctx.user`, `ctx.requestId`, etc.).
