---
'@miiajs/testing': patch
---

A `compile()` that throws destroys the app it built before rethrowing, so the global logger it silenced with `logger: false` comes back even though the test never reaches `close()`.
