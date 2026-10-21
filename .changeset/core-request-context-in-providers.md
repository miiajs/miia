---
'@miiajs/core': patch
---

A module that declares `REQUEST_CONTEXT` in its `providers` (or in the providers of a `configure()` result) throws at startup, like `provide()` and `override()` of it, instead of silently keeping the built-in context. The message names the module: `[Miia] AppModule declares REQUEST_CONTEXT in providers - ...`.
