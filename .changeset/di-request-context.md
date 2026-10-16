---
'@miiajs/core': minor
---

Request-scoped providers get the context of their request and a cleanup hook. `REQUEST_CONTEXT` is a built-in request-scoped token: `inject(REQUEST_CONTEXT)` in a request-scoped class, `resolve(REQUEST_CONTEXT)` in a request-scoped factory. Like any request-scoped token, a singleton or transient cannot inject it, and `app.get()` / `Resolver` throw for it.

Once the pipeline of a request has finished and its response is built, the instances the request created get `onDestroy()`, newest first. The hooks do not hold the response back, and one that throws is logged while the rest still run. A singleton a request-scoped factory returns, a lazy proxy and the context itself are not destroyed. A request that reaches only singletons and transients through `ctx.resolve()` allocates no scope. Breaking:

- `ctx.resolve()` of a request-scoped token after the request's pipeline has finished throws (`[Miia] Request-scoped X was resolved after its request finished (e.g. from a streaming response) - resolve it in the handler before returning`); singletons and transients still resolve. A streaming response resolves what it needs in the handler
- a request-scoped instance with an `onDestroy()` method now has it called at the end of every request
