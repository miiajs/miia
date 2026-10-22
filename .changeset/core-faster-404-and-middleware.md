---
'@miiajs/core': patch
---

Faster 404s and middleware pipelines. An app without global middleware answers an unmatched route without building a `NotFoundException`, with the same 404 response as before. Under global middleware the `NotFoundException` a middleware can catch is built without collecting a stack on Node and Deno: its `stack` is the first line, `NotFoundException: Cannot GET /x` (on Bun it is collected as before). `compose()`, and every route and global pipeline built on it, no longer wraps each level in an async function: a middleware that throws synchronously still rejects the returned promise and a second `next()` still rejects with `next() called multiple times`, while the promise now resolves to whatever the first middleware returned, as in koa-compose. Static routes are looked up per method without building a key per request.

A HEAD request never serializes the handler's return value, behind route or global middleware too, and a body the handler already set (`ctx.res.stream()`, `ctx.res.text()`) keeps the Content-Type it has on GET: HEAD no longer adds `application/json` next to a stream.
