---
'@miiajs/core': minor
'@miiajs/drizzle': patch
'@miiajs/papr': patch
'@miiajs/mongoose': patch
---

New `createLazyProxy()` export in core. Lazy connection and model proxies no longer resolve when lifecycle hooks are probed - module order no longer breaks `init()`. The proxies are also no longer resolved ahead of time by `init()`, so a failing lookup surfaces on first use (in practice only in hand-built containers: `configure()` registers the `drizzleDb()` / `paprDb()` / `mongooseConnection()` tokens itself).
