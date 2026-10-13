# @miiajs/swagger

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

- [`469682a`](https://github.com/miiajs/miia/commit/469682a51f8c6e84192cba8db8c2eae57c895e38) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Document 200 for a `POST` route without `@Status`

  The spec gave a `POST` route without `@Status` a default `201` response, while the runtime answers such a route with
  200 when the handler returns a body (an empty result is 204, as for every method). The default success response is now
  200 for every method. Declare `@Status(201)` on create endpoints: it sets the runtime status and the spec follows it.

- Updated dependencies [[`36d1f60`](https://github.com/miiajs/miia/commit/36d1f6056e2e19e7fec5d26c25ebc7a43693bdc9)]:
  - @miiajs/serve-static@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @miiajs/serve-static@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies []:
  - @miiajs/serve-static@0.6.1

## 0.6.0

### Minor Changes

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

- Updated dependencies [[`fafb103`](https://github.com/miiajs/miia/commit/fafb1036bb5e7658fd7971d380e321c0e080798e), [`44f697d`](https://github.com/miiajs/miia/commit/44f697dd16deaf58c8af37269405ac961967c76f)]:
  - @miiajs/serve-static@0.6.0

## 0.5.0

### Minor Changes

- [`ffb749d`](https://github.com/miiajs/miia/commit/ffb749d51d6908f8e44bf69263716d6924a694ce) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Fix five accuracy problems in the OpenAPI document generated by `@miiajs/swagger`.

  **Guards declare their own rejection codes.** Every route with any guard used to get a blanket
  `403 Forbidden`, even when the guard rejects with 401 or 429. A guard class now states its
  statuses through the new `GUARD_RESPONSES` symbol from `@miiajs/core`
  (`static [GUARD_RESPONSES] = [401]`, or `[{ status: 403, description: '...' }]`, typed as
  `GuardResponseDeclaration`), and a guard without the marker adds no responses at all.
  `AuthGuard` from `@miiajs/auth` declares 401 and the `@miiajs/rate-limit` guards declare 429,
  so both work without any user action. `@SkipGuard(...)` and `@SkipRateLimit()` drop the guard's
  responses along with the guard, and the builder now also sees global guards from
  `app.useGuard()` (via the new `Router.globalGuards`), which it previously ignored entirely.

  **Default success response.** The implicit 201-for-POST / 200-otherwise response was only
  suppressed by an explicit `@ApiResponse` of the _same_ status, so a `POST` documented with
  `@ApiResponse(200)` emitted both 200 and 201. Any explicit 2xx or 3xx response now replaces
  the default.

  **Default response body.** The default always drew a `application/json` body and described
  every status as `OK`. The description now comes from the status table (204 -> `No Content`)
  and `content` is attached only for 2xx statuses other than 204 and 205, so `@Status(204)`
  routes and redirects no longer carry a phantom JSON body.

  **Schema conversion.** When a schema can export JSON Schema itself (`toJSONSchema()` in zod 4,
  `toJsonSchema()` elsewhere), that output is used instead of the package's own walk. `.pipe()`
  and `.transform()` no longer collapse to `{ type: 'object' }`, `z.literal()` works on zod 4,
  and nullable becomes `anyOf` instead of `type: [...]`. A string carrying a `format` is documented
  by that format alone, without the regex Zod ships next to it, because Swagger UI generates its
  example from `pattern` and would render an unreadable one; a `pattern` written by hand with
  `.regex()` has no `format` beside it and is kept. Request
  bodies and parameters are converted from the input side of the schema, responses from the
  output side, with `format` carried over from the output side so
  `z.string().trim().toLowerCase().pipe(z.email())` stays `{ type: 'string', format: 'email' }`.
  Detection is duck-typed - zod is not a dependency of the package - and zod 3 plus raw JSON
  Schema objects keep going through the existing converter.

  **`$defs` and recursive schemas.** Schemas tagged with `.meta({ id })` and self-referencing
  schemas produced dangling `#/$defs/...` and `#` pointers. They are now lifted into
  `components.schemas` with the references rewritten; colliding names are suffixed with
  `_Input` / `_Output`.

  Existing users will see their generated spec change: 403 entries disappear from routes whose
  guards do not declare one, guard-driven 401/429 entries appear where they belong, duplicate
  success responses collapse to a single entry, 204 and redirect responses lose their JSON body,
  and schemas converted through the native exporter are described more precisely than before.
  Two things stay outside the document by design: a guard registered with `app.useGuard()` after
  `app.init()` (the spec is serialized once in `onReady`) and the perimeter `rateLimit()`
  middleware, which carries no metadata to read - only the guard layer is documented.

### Patch Changes

- [`17f89f2`](https://github.com/miiajs/miia/commit/17f89f23b85be69cbc5d28f3bed34ce5a938efb3) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add an app-level global prefix that mounts the whole app under a path segment without changing
  what it documents.

  **`new Miia({ globalPrefix: '/api' })`.** The prefix is prepended in `Router.add()`, so it applies
  to everything registered through the router - controller routes, `app.addRoute()`, and the wildcard
  route installed by `serveStatic()`. `'api'`, `'/api'`, and `'/api/'` are normalized to the same
  value; a prefix containing `*`, `:`, `?`, `#`, or whitespace throws a `TypeError`, because `*`
  would collapse the route table onto a single wildcard slot and `:` would inject a parameter segment
  into every path. Start-up route logs print the prefixed path, so `Mapped {/api/users, GET}` matches
  what the server actually serves.

  **The constructor option is the only form.** MiiaJS resolves routes eagerly at `register()` /
  `addRoute()` rather than at `listen()`, so a prefix assigned after a route exists would apply to
  later routes only. It throws instead, with a message pointing at the constructor option. There is no
  `Miia.setGlobalPrefix()` method: it would add no capability the constructor lacks, while carrying the
  name of Nest's method and the opposite ordering contract. The check lives in the `Router.globalPrefix`
  setter, so every path into it is guarded.

  **The prefix stays out of the OpenAPI spec.** It never reaches `RESOLVED_PREFIX`, so
  `@miiajs/swagger` keeps documenting `/users` while the app serves `/api/users` - the opposite of
  `@Module({ prefix })`, which is part of the resolved controller path and does appear in `paths`.
  Write the base URL including the prefix into `servers` yourself, otherwise "Try it out" in Swagger
  UI sends the request to the unprefixed path. Swagger's own endpoints now register with
  `skipGlobalPrefix: true` and stay at their configured `path` / `uiPath`.

  **Escape hatches.** The options object `app.addRoute()` takes carries a `skipGlobalPrefix` flag, so a
  route that must answer at a fixed URL - a health check, a platform probe - opts out with
  `app.addRoute('GET', '/health', handler, { skipGlobalPrefix: true })`. `Router.add()` takes the same
  options for routes registered from a provider's `onReady()` the way swagger does.

  `@miiajs/serve-static` grows a matching `skipGlobalPrefix` option, forwarded to the wildcard route it
  registers. Without it, `new Miia({ globalPrefix: '/api' })` plus `serveStatic(app, '/', './dist')`
  moves a root-mounted SPA to `/api/*`, where the browser never looks for it. The flag lives on a new
  exported `ServeStaticMountOptions` type, which `serveStatic()` takes; `createStaticHandler()` keeps
  taking `ServeStaticOptions`, which has no mount of its own to move.

  `@miiajs/testing` gets a `TestApp.setGlobalPrefix()` builder method - `TestApp` has one even though
  `Miia` does not, because a test app is assembled through a builder rather than constructed directly.
  Safe to call before `compile()`, since modules are registered there.

  Path resolution is unchanged for apps that do not set a prefix: without one, `Router.add()` stores
  exactly the path it stored before.

- Updated dependencies [[`17f89f2`](https://github.com/miiajs/miia/commit/17f89f23b85be69cbc5d28f3bed34ce5a938efb3)]:
  - @miiajs/serve-static@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @miiajs/serve-static@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @miiajs/serve-static@0.3.0

## 0.2.0

### Patch Changes

- [`7ccf372`](https://github.com/miiajs/miia/commit/7ccf3729590c8446eec61d2fb55320f69bca5c26) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Auto-install internal implementation dependencies.

  `@miiajs/swagger` requires `@miiajs/serve-static` to serve the Swagger UI bundle, and `@miiajs/messaging-redis` requires `@miiajs/messaging` as the abstract bus it implements a transport for. In `0.1.1` these were declared as `peerDependencies`, which meant `bun add @miiajs/swagger` did not install `@miiajs/serve-static` automatically and the consumer had to know about it and add it manually.

  Move both back to `dependencies` (as plain semver `^0.2.0`, not `workspace:` - the workspace protocol would still leak into the published package). `@miiajs/core` stays a `peerDependency` because it is the framework root and a single instance must be shared across all plugins.

- Updated dependencies:
  - @miiajs/core@0.2.0
  - @miiajs/serve-static@0.2.0

## 0.1.1

### Patch Changes

- [`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Fix `workspace:*` leaking into published packages.

  The `0.1.0` release published `"@miiajs/core": "workspace:*"` (and other internal `@miiajs/*` deps) into the npm registry, causing `yarn add @miiajs/<pkg>` to fail with `Couldn't find any versions for @miiajs/core that matches workspace:*`. `changeset publish` invokes `npm publish` under the hood, and npm does not resolve the workspace protocol when the lockfile is `bun.lock`.

  Internal `@miiajs/*` dependencies are now declared as `peerDependencies` (`^0.1.0`, plain semver) plus `devDependencies` (`workspace:*` for local linking). This is the canonical pattern for framework plugins (NestJS-style):

  - Guarantees a single `@miiajs/core` instance in the consumer's `node_modules` (required for DI and decorator metadata to work).
  - Lets the consumer control the `@miiajs/core` version they install.
  - Eliminates `workspace:*` from the published `package.json` `dependencies`.

  Affected packages: `auth`, `config`, `drizzle`, `jwt`, `messaging`, `messaging-redis`, `mongoose`, `papr`, `serve-static`, `swagger`.

- Updated dependencies [[`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee), [`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee)]:
  - @miiajs/core@0.1.1
  - @miiajs/serve-static@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [[`bf9132d`](https://github.com/miiajs/miia/commit/bf9132d16ee802cf1880a61ffd6fa018ee4d9e89)]:
  - @miiajs/core@0.1.0
  - @miiajs/serve-static@0.1.0
