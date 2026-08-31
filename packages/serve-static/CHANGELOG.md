# @miiajs/serve-static

## 0.7.0

## 0.6.1

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

## 0.5.0

### Minor Changes

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

## 0.4.0

## 0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies:
  - @miiajs/core@0.2.0

## 0.1.1

### Patch Changes

- [`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Fix `workspace:*` leaking into published packages.

  The `0.1.0` release published `"@miiajs/core": "workspace:*"` (and other internal `@miiajs/*` deps) into the npm registry, causing `yarn add @miiajs/<pkg>` to fail with `Couldn't find any versions for @miiajs/core that matches workspace:*`. `changeset publish` invokes `npm publish` under the hood, and npm does not resolve the workspace protocol when the lockfile is `bun.lock`.

  Internal `@miiajs/*` dependencies are now declared as `peerDependencies` (`^0.1.0`, plain semver) plus `devDependencies` (`workspace:*` for local linking). This is the canonical pattern for framework plugins (NestJS-style):

  - Guarantees a single `@miiajs/core` instance in the consumer's `node_modules` (required for DI and decorator metadata to work).
  - Lets the consumer control the `@miiajs/core` version they install.
  - Eliminates `workspace:*` from the published `package.json` `dependencies`.

  Affected packages: `auth`, `config`, `drizzle`, `jwt`, `messaging`, `messaging-redis`, `mongoose`, `papr`, `serve-static`, `swagger`.

- Updated dependencies [[`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee)]:
  - @miiajs/core@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [[`bf9132d`](https://github.com/miiajs/miia/commit/bf9132d16ee802cf1880a61ffd6fa018ee4d9e89)]:
  - @miiajs/core@0.1.0
