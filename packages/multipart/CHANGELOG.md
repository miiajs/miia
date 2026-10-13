# @miiajs/multipart

## 0.8.0

### Minor Changes

- [`84f5045`](https://github.com/miiajs/miia/commit/84f50455207e88af0fa234150473b92c4d7366c0) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Move request schemas into the route decorator

  `@ValidateBody`, `@ValidateQuery` and `@ValidateParams` (core) and `@ValidateForm` (multipart) are removed, with no
  aliases. A route's schemas now go into its HTTP method decorator: `@Post(path?, { body, query, params })`, or
  `@Post({ ... })` for a route at the controller prefix. GET, HEAD and OPTIONS take `query` and `params` only. The option
  types `RouteOptions` and `RouteOptionsWithoutBody` are exported from `@miiajs/core`. `@Multipart` now only says how the
  body is read and within which limits; the route's `body` schema validates the form.

  **Migration.** Move each schema into the route decorator and drop the old import. Handlers read the data the same way
  as before: `ctx.json<T>()`, `ctx.query`, `ctx.params`, `ctx.form<T>()`.

  ```ts
  // Before
  @Post('/')
  @ValidateBody(CreateUser)
  create(ctx: RequestContext) {}

  @Get('/')
  @ValidateQuery(Paging)
  list(ctx: RequestContext) {}

  @Patch(':id')
  @ValidateParams(IdParams)
  @ValidateBody(UpdateUser)
  update(ctx: RequestContext) {}

  @Post('avatar')
  @Multipart({ maxFileSize: MAX, maxFiles: 1 })
  @ValidateForm(AvatarForm)
  upload(ctx: MultipartContext) {}

  // After
  @Post('/', { body: CreateUser })
  create(ctx: RequestContext) {}

  @Get({ query: Paging })
  list(ctx: RequestContext) {}

  @Patch(':id', { params: IdParams, body: UpdateUser })
  update(ctx: RequestContext) {}

  @Post('avatar', { body: AvatarForm })
  @Multipart({ maxFileSize: MAX, maxFiles: 1 })
  upload(ctx: MultipartContext) {}
  ```

  **Behaviour changes.**

  - The order is fixed: params, then query, then body. Before, decorator order decided it, so `@ValidateParams` above
    `@ValidateBody` checked the body first. Invalid params together with an invalid body now answer
    `'Params validation failed'` instead of `'Body validation failed'`.
  - Validation runs after every guard and every route middleware, right before the handler. A method-level `@Use` used
    to run before or after a `@Validate*` depending on decorator order; it now sees the raw `ctx.params`, `ctx.query` and
    body before `await next()` and the validated ones after it.
  - Some mistakes now throw a `TypeError` when the class is defined: a `body` schema on GET, HEAD or OPTIONS; a GET, HEAD
    or OPTIONS route and a `body` schema on the same handler, in either decorator order; two different schemas for the
    same key on one handler. Routes stacked on one method share its schemas.
  - A multipart form that fails its schema answers `'Body validation failed'`, not `'Form validation failed'`.
  - `BODY_SCHEMAS`, `QUERY_SCHEMAS` and `PARAMS_SCHEMAS` now turn on runtime validation: the router builds the validation
    step from them, so a custom decorator that writes them gets its routes validated.

  **`@ApiBody` and 422.** `@ApiBody` no longer writes `BODY_SCHEMAS` and no longer adds a 422 response on its own. It
  keeps its own key, only documents, and overrides the route's `body` schema and content type in the spec whatever the
  decorator order. The spec gets a 422 only when the route declares a `body`, `query` or `params` schema, so a route
  whose own code answers 422 behind an `@ApiBody` should declare `@ApiResponse(422)`. The request body's content type is
  the `@ApiBody` option, else the route's body reader (`multipart/form-data` under `@Multipart`), else `application/json`.

  **Body readers.** `BODY_READERS` (`Map<handlerName, BodyReader>`) and the `BodyReader` type
  (`{ contentType, read(ctx), commit(ctx, data) }`) are new exports of `@miiajs/core`. A reader decides what a route's
  `body` schema validates and where the validated data goes; `contentType` is what the spec shows. Without one the
  built-in JSON reader is used: malformed JSON answers 400 before the schema runs, an empty body reaches the schema as
  `undefined`, and an oversized body stays a 413. `@Multipart` registers a form reader.

### Patch Changes

- [`36d1f60`](https://github.com/miiajs/miia/commit/36d1f6056e2e19e7fec5d26c25ebc7a43693bdc9) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Lower the runtime floors to what the packages need.

  Node moves from `24.18.1` to `22.12.0`. Nothing in the packages needs Node 24. 22.12.0 is the first
  22.x release where `require(esm)` is on by default, so CommonJS code can `require()` these ESM-only
  packages, and it is the floor `papr@17` declares. The old floor tracked the 24.17.0 and 24.18.1
  security releases; `engines` cannot enforce a patch level, so that advice now lives in `SECURITY.md`.

  Deno moves from `2.6.1` to `2.0.0`, with two exceptions. Projects that `@miiajs/cli` runs on Deno
  need 2.4.0, the first release with the `--sloppy-imports` flag the CLI passes. `@miiajs/serve-static`
  needs 2.5.0: on 2.0 through 2.4 Deno's `Readable.toWeb` throws an uncaught error once a file has been
  sent and takes the process down.

  `@miiajs/uws-server` now declares Node.js 22, 24 and 26 only, with no Bun or Deno range:
  uWebSockets.js ships binaries for those three lines and never loaded anywhere else.
  `@miiajs/node-server` drops its Deno range: Deno apps listen through `Deno.serve` and never need the
  adapter, and it is not tested there.

  Bun stays at `1.4.0`.

  The documented TypeScript requirement moves from 5.7 to 6.0. The `ES2025` target that the docs and
  `miia new` use does not exist before TypeScript 6.0, so 5.7 through 5.9 never worked with that setup.

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
