---
'@miiajs/config': patch
---

`ConfigService.getOrThrow(key)` returns `Exclude<T[K], undefined>`: it throws on `undefined`, so the type no longer carries it, and `const url: string = config.getOrThrow('DATABASE_URL')` compiles for an optional key. `null` stays in the type, as it is returned.
