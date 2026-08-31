# @miiajs/multipart

## 0.7.0

## 0.6.1

## 0.6.0

### Minor Changes

- [`158ed35`](https://github.com/miiajs/miia/commit/158ed353653f4bde444ede757649ac09acc03ece) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add `@miiajs/multipart`: streaming `multipart/form-data` with per-part backpressure.

  `@Multipart(options?)` opens a route and attaches two ways to read the body, both typed by the
  exported `MultipartContext`. `ctx.parts` is an async iterator over the parts - a file part carries
  a `ReadableStream`, and the source is read only when every queue the consumer can still drain is
  empty, so a large upload streams through instead of landing in memory. Exactly one part is consumed
  at a time: moving the iterator forward abandons the previous part and errors its stream rather than
  closing it, so a half-read upload can never look complete. `ctx.form<T>()` is the buffered path -
  one pass into `{ files, fields }`, cached per request like `ctx.json()`.

  `@ValidateForm(schema)` validates the buffered form against a flat object - text fields next to
  files under their own names, the way OpenAPI describes a multipart body - answers 422 on failure,
  and replaces the cache so `ctx.form<T>()` returns the schema's data.

  Limits are per file, per part count, and per form: `maxFileSize`, `maxFiles`, `maxFields`,
  `maxFieldSize`, `maxFieldNameSize`. The route's body budget follows an explicit `bodyLimit`,
  otherwise `maxFileSize * maxFiles + fieldsBudget` when both are finite, otherwise a `@BodyLimit`
  on the method or controller. Exceeding a limit is a 413, a malformed or non-multipart body a 400.

  `allowedTypes` restricts file parts to a list of media types (exact, or `image/*`), refusing a part
  with a 415 before its body is read. It reads the part's declared `Content-Type`, so treat it as an
  early, uniform rejection rather than a content check.

- [`fafb103`](https://github.com/miiajs/miia/commit/fafb1036bb5e7658fd7971d380e321c0e080798e) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Raise the Bun floor from `1.3.11` to `1.4.0`.

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

- [`44f697d`](https://github.com/miiajs/miia/commit/44f697dd16deaf58c8af37269405ac961967c76f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Raise the Node floor from `22.22.1` to `24.18.1`.

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

### Patch Changes

- [`d10b3bb`](https://github.com/miiajs/miia/commit/d10b3bb4d8b304896ce38de290009971a23c3940) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Raise an error when `ctx.parts` and `ctx.form()` are both used on one request.

  They read the same source, so whichever ran second found it spent - and said nothing about it.
  `ctx.form()` after walking the parts answered `{ files: {}, fields: {} }`, and walking the parts
  after `ctx.form()` iterated zero times. Both read like a request that parsed cleanly and happened to
  carry no data, which is the worst way for this to fail.

  `ctx.parts` is now handed to the handler wrapped, so the package can tell the handler's own walk
  apart from the one `ctx.form()` does internally. Mixing the two throws; everything else is untouched -
  `ctx.form()` still caches across repeated calls, and `@ValidateForm` still replaces that cache and
  hands its data to the handler.
