---
'@miiajs/core': minor
---

`onInit()` and `onReady()` run in dependency order: a provider's hooks run after the hooks of the singletons it resolved while being constructed, otherwise registration order. A factory provider that resolves a dependency lazily (after construction, e.g. through a lazy proxy) lists it in the new `deps` option - `provider(token, factory, { deps })` or `{ token, factory, deps }`; an unregistered token in `deps`, or a cycle that exists only through `deps`, fails `init()` - the cycle with `deps of A lists B: drop that entry, or move the shared logic into a provider both depend on`. An instance registered under several tokens gets each hook once. Global guards from `app.useGuard()` are built with the other singletons, so their field initializers run before any `onInit()`, and they receive `onInit()` too.
