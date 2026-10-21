---
'@miiajs/node-server': patch
'@miiajs/uws-server': patch
---

In `mode: 'optimized'` the request body is read once, as from a real `Request` (and as in `mode: 'native'`, on Bun and on Deno). Once `ctx.json()`/`ctx.text()` or any of `ctx.req.json()`/`text()`/`arrayBuffer()`/`bytes()`/`blob()`/`formData()` has taken the body, or `ctx.req.body` has been read, the next consumer rejects with `TypeError: Body is unusable: Body has already been read`, `ctx.req.clone()` throws `TypeError: unusable` as Node's own `Request` does, a `ctx.req.body` stream is locked, and `ctx.req.bodyUsed` is `true`. Before, a small body with a Content-Length (the buffered path) could be read again, or cloned after it was read, so the escape hatch after the helpers returned the body a second time instead of throwing as documented. `ctx.req.bytes()`, which the request lacked in this mode, is there now and reads the body the same way. On uws-server a stream read through `ctx.req.body` now also counts in `bodyUsed`. `ctx.json()` and `ctx.text()` still share one read.
