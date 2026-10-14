---
'@miiajs/core': minor
---

Request-scoped providers live on the request context, so concurrent requests no longer share or swap instances. Breaking:

- reach a request-scoped provider with the new `ctx.resolve(Token)`; another request-scoped provider can still `inject()` it
- a singleton or transient that injects a request-scoped provider throws (a singleton at startup), naming both sides
- `app.get()` and `Resolver.resolve()` of a request-scoped token throw outside a request
- controllers and guards must be singletons
- `Container.clearRequestScope()` is removed
