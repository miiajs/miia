---
'@miiajs/core': minor
'@miiajs/auth': patch
'@miiajs/rate-limit': patch
---

Guards and `Resolver` are checked against module boundaries. A guard declared in a module's `providers` is a provider: a controller in another module uses it once that module exports it and the controller's module imports it, and one passed to `app.useGuard()` must be visible from the root. A guard no module declares - a class put straight into `@UseGuard()` or `app.useGuard()`, `AuthGuard(...)`, `@RateLimit()` - is built once, and what it injects is checked from the module of every controller that uses it, and from the root when it is global. The violations join the start-up report:

```text
AuthGuard(JwtAuth) (guard of UsersController in UsersModule) injects JwtAuth (AuthModule):
  - add JwtAuth to AuthModule `exports`
  - add AuthModule to UsersModule `imports`
```

`inject(Resolver)` returns a resolver bound to the module of the provider that injects it (a factory's `resolve(Resolver)` too, with the host of a `configure()` result); `app.get(Resolver)`, `TestApp.resolve(Resolver)`, `app.provide()` providers and guards no module declares get the one bound to the root. An override of `Resolver` stays one fake for every module. The auth and rate-limit guard classes are named for these messages: `AuthGuard(JwtAuth, ApiKeyAuth)`, `RateLimitGuard`, `RateLimitGuard({...})` and `@RateLimit({...})` - the policy is never printed. Breaking:

- `Resolver.has()` is `false` for a token the module of the resolver cannot see, and `resolve()` / `resolveOptional()` of one is a boundary violation - in the start-up report during startup, thrown at once after it (`Resolver of PluginsModule resolved ReportsService (ReportsModule), which PluginsModule cannot see:`); `resolveOptional()` returns `null` only for a token nothing registers
- `Resolver` throws for a request-scoped token even while `ctx.resolve()` builds a request-scoped provider - inject it there instead
- a guard no module declares fails startup when a module whose controllers use it, or the root for a global one, cannot see what it injects - typically an auth provider: make the module that declares it `global` and export it
- a guard from the `providers` of one module used by a controller of another fails startup unless it is exported and imported, and so does a guard in `app.useGuard()` that only a module's `providers` declare, until a module passed to `app.register()` exports it
