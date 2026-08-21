---
'@miiajs/core': minor
'@miiajs/node-server': minor
'@miiajs/uws-server': minor
'@miiajs/multipart': minor
'@miiajs/serve-static': minor
'@miiajs/testing': minor
'@miiajs/auth': minor
'@miiajs/jwt': minor
'@miiajs/config': minor
'@miiajs/rate-limit': minor
'@miiajs/swagger': minor
'@miiajs/messaging': minor
'@miiajs/messaging-redis': minor
'@miiajs/drizzle': minor
'@miiajs/papr': minor
'@miiajs/mongoose': minor
'@miiajs/cli': minor
---

Raise the Node floor from `22.22.1` to `24.18.1`.

The floor lands on that release rather than on `24.0.0` because 24.17.0 and 24.18.1 were both security
releases, and what they fix is what a framework that is itself an HTTP server runs on: hostname
normalization for TLS server identity checks, two high-severity http2 fixes covering header memory
retention in session accounting and a deferred rst stream, response queue poisoning in `http.Agent`,
and a refusal for requests that exceed the maximum header count. 24.18.1 also carries llhttp 9.4.3 and
undici 7.29.0.

The 24 line itself marks `require(esm)` and the module compile cache stable and raises the default
`Buffer.poolSize` to 64 KiB.

`@miiajs/uws-server` is unaffected by the move: uWebSockets.js 20.69.0 ships a `137` binary, so Node 24
already loaded it.

Types stay on `@types/node@^24.13.3`, which is where DefinitelyTyped ended the 24 line. The APIs added
in 24.16 through 24.19 - `req.signal` on `IncomingMessage`, the `httpValidation` server option,
`blob.textStream()` - are there at runtime but carry no type definitions yet.
