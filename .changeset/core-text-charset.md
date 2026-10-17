---
'@miiajs/core': patch
---

`ctx.res.text()` and `ctx.res.html()` send `charset=utf-8` with their content type (`text/plain; charset=utf-8`, `text/html; charset=utf-8`). Without it a browser reads `text/plain` as windows-1252 and garbles anything outside ASCII; `@miiajs/serve-static` already labels the same types this way.
