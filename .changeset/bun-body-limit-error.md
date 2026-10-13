---
'@miiajs/core': patch
---

Map Bun's oversized-body error to 413 inside the app

Bun rejects a body over `maxRequestBodySize` with a plain `Error`. Core now recognises it by its message and turns it
into `PayloadTooLargeException` (413) in `ctx.text()`, `ctx.json()` and the error handler. A route with a `body` schema
no longer runs the schema on `null` and answers 422, and multipart (`ctx.parts`, `ctx.form()`) and raw reads
(`ctx.req.arrayBuffer()`, `ctx.req.body`) no longer log an unhandled error and build a 500. The client already got
Bun's own 413; this changes what the app sees.
