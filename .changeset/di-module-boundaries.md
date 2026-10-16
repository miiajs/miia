---
'@miiajs/core': minor
---

Module boundaries are checked. A provider sees the providers of its own module, what the modules it imports list in `exports` (re-exports followed) and the exports of `global` modules; built-in tokens and `app.provide()` tokens are visible to every module. Checked from the module of the provider that asks: every `inject()` / `injectOptional()` during construction, every `resolve()` of a factory provider - bound to that provider for life, so a late call from a lazy proxy is checked from it too - and every token in `deps`. A provider registered with `app.provide()` and a global guard no module declares are checked from the root, which sees what the modules passed to `register()` export; the factories of a configured module also see what the module importing it sees. During startup the violations are collected into one report thrown before the first `onInit()`, naming both modules and the fix:

```text
[Miia] 1 module boundary violation:

OrdersService (OrdersModule) injects UsersService (UsersModule):
  - add UsersService to UsersModule `exports`
  - add UsersModule to OrdersModule `imports`

Docs: /docs/core-concepts/modules#boundaries
```

"No provider" and both cycle messages name the module next to each token (`required by OrdersService (OrdersModule)`, `required by deps of Lazy (AppModule)`). Breaking:

- a provider that injects, resolves or lists in `deps` a token its module cannot see fails `init()` (and `app.get()` before it) with the report; the app stays dead after it, so every later `init()`, `app.get()` and request rethrows it
- an error that ends startup early - a missing provider, a cycle, an error a factory wraps in its own - carries the violations found before it, appended as `Also found N module boundary violations so far:`, with the original error as `cause`
- a module without `exports`, a `configure()` result included, exports nothing - infrastructure every module injects needs `{ global: true }` or a bare import of the configured class
- `injectOptional()` of a registered token the module cannot see is a violation instead of `null`
- after startup a violation throws at once: a transient or request-scoped provider built during a request, or a factory's `resolve()` called later
- the "No provider" text for `deps` changes from `required by Lazy (deps)` to `required by deps of Lazy (AppModule)`
