---
'@miiajs/core': minor
'@miiajs/testing': minor
'@miiajs/swagger': patch
---

The module graph is processed once, on the first `init()`, `app.get()` or `fetch()`, so the order of `register()` calls no longer matters. Breaking:

- `register()` and `provide()` after the graph is processed throw; a graph that failed to process rethrows its first error on every later `init()` / `app.get()`
- `use()`, `useGuard()` and `addRoute()` after `init()` throw instead of being picked up by a lazy recompile on the next request
- a route registered twice (same method and path, param names ignored) throws instead of silently replacing the first
- `TestApp` collects every builder call and builds the app in `compile()`; builder calls after `compile()`, and `request()` / `resolve()` / `close()` before it, throw
