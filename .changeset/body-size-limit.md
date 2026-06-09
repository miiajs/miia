---
'@miiajs/core': minor
'@miiajs/node-server': minor
'@miiajs/uws-server': minor
---

Add framework-level request body size limits.

`new Miia({ maxBodySize })` (default 1 MiB, `false` to disable) plus a dual class/method
`@BodyLimit(bytes)` decorator (method > class > app default), enforced via a new
`PayloadTooLargeException` (413). Limits are resolved into the route table at registration
time (zero metadata lookups at runtime); declared Content-Length is checked in core after
route matching, and chunked bodies are capped at the adapter level: Bun via
`maxRequestBodySize`, Deno via a counting stream wrapper, and `@miiajs/node-server` /
`@miiajs/uws-server` via a new `maxBodySize` option (early 413 on Content-Length,
in-stream byte cap for chunked bodies that rejects with an Error named
`'PayloadTooLargeError'`, mapped to 413 by core).

Note: standalone `serve()` from the server adapters now defaults to a 1 MiB body cap;
pass `maxBodySize: false` to restore the old unlimited behavior.
