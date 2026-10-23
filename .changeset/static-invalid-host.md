---
'@miiajs/serve-static': patch
---

A request whose `Host` header makes no URL is served instead of answered with a 500. Bun hands such a request (`Host: x/y`) over with a relative `req.url`, and node-server in `mode: 'optimized'` keeps a `Host` like `x:99999` in it; `new URL(req.url)` threw on both when the handler built a 404 or a trailing-slash redirect. The path is now read from the url either way, and the redirect for such a request carries a path-only `Location` (`/static/docs/?v=1`).
