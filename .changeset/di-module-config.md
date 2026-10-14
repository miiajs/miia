---
'@miiajs/core': minor
'@miiajs/testing': minor
---

A configured module is identified by the pair (class, `name`), and a bare `imports: [XModule]` resolves to the module's configuration wherever it sits in the graph, regardless of order - before, a bare import reached first silently dropped the `configure()`. `TestApp.override()` builds an override descriptor (`overrideProvider()` / `overrideModule()`, exported from core) that goes through `register()` and replaces one entry, instead of racing `provide()` against the modules; `override(XModule, XModule.configure(test))` replaces a configured module. Breaking:

- two `configure()` calls of the same module without a `name` throw `[Miia] X is configured twice (A, B)` instead of the first one silently winning
- `TestApp.override()` of a token that no loaded module provides and that is not in the container throws on `compile()`; so does an override of a module the graph does not configure
- overriding a guard that is not declared in a loaded module's `providers` no longer works - declare the guard in `providers`
