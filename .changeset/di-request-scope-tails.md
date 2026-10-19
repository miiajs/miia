---
'@miiajs/core': patch
---

`app.destroy()` waits for the `onDestroy()` of request-scoped instances of requests that have already finished, before any `onShutdown()`, so those hooks still see working singletons; a request still running when shutdown starts is not waited for. `provide()` and `override()` of `REQUEST_CONTEXT` throw instead of replacing the context of every request with a singleton - test a request-scoped provider through a route, or override that provider itself.
