---
'@miiajs/core': patch
---

`cors()` with any `origin` but `'*'` adds `Origin` to `Vary` on every response. A list or a predicate used to send no `Vary` when the request's origin was refused or missing, so a shared cache could keep that answer, without `Access-Control-Allow-Origin`, and hand it to an allowed origin. `Origin` is appended to a `Vary` an earlier middleware set instead of replacing it, and is not added again when `Vary` already lists it or is `*`.
