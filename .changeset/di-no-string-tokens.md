---
'@miiajs/core': minor
'@miiajs/testing': minor
---

A DI token is a class (abstract ones included) or a `createToken()` object. Breaking:

- string tokens are gone from `inject()`, `injectOptional()`, `app.get()`, `ctx.resolve()`, `Resolver`, factory providers and `TestApp.override()` / `TestApp.resolve()` - replace `'API_KEY'` with `createToken<string>('API_KEY')`
- `@Injectable({ token })` is removed - register the class itself, or a `provider(token, ...)` for a token object
- `Container` and `runInContainerContext` are no longer exported from `@miiajs/core` - build an app with `new Miia().provide(...)` / `register(...)` and read providers with `app.get()`, or use `TestApp`
