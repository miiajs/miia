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

Raise the Bun floor from `1.3.11` to `1.4.0`.

Bun 1.4 makes `Bun.serve` pause a `ReadableStream` request body when the consumer stops draining it, so
a stalled handler now holds the client back instead of letting the runtime buffer the upload. That is
what the streaming contract in `@miiajs/multipart` describes, and on 1.3 it was only true of Deno and
`@miiajs/node-server`.

Two further behaviours were measured as fixed on 1.4.0 but are not part of Bun's published release
notes, so treat them as observations rather than guarantees: `maxRequestBodySize` now also rejects a
body sent without a `Content-Length`, and a connection survives a response written before the request
body was drained - on 1.3 the next request on that connection came back as an empty `400`.

The `Readable.fromWeb` workaround the multipart docs carried is gone with the floor: on 1.3.12 it never
settled once the web stream errored, and on 1.4.0 it rejects like Node does.
