# @miiajs/core

## 0.6.1

## 0.6.0

### Minor Changes

- [`0c897f1`](https://github.com/miiajs/miia/commit/0c897f1c52408dfe120c6a1077f07a81f2e5b60f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add `UnsupportedMediaTypeException` (415) to the exception hierarchy, and `415` to the status-text
  map behind `HttpException.toJSON()`, so a media-type rejection reads `"error": "Unsupported Media
Type"` instead of the generic `"error": "Error"`.

  `@miiajs/multipart` raises it when a file part declares a media type outside `allowedTypes`; it is
  exported like every other built-in exception, so applications can throw it directly for any
  content-negotiation refusal of their own.

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

- [`ca3665d`](https://github.com/miiajs/miia/commit/ca3665da1ad950d949fbbe52b6e06c12f6f90f13) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Enforce the per-route body limit on requests that declare no `Content-Length`.

  Until now `@BodyLimit` and `maxBodySize` only ever met the declared length. A chunked body has none,
  so the sole bound on it was the adapter's ceiling - `max(maxBodySize, every @BodyLimit in the app)`.
  A route declaring `@BodyLimit(4096)` accepted a 900 KB chunked body, and a single generous upload
  route raised what every other route would swallow.

  `checkBodyLimit()` now also narrows the adapter's `_bodyLimit` slot to the matched route's limit,
  which is possible because routing has already happened by then. The write uses `Math.min`, so an
  adapter given a stricter cap of its own - `serve({ maxBodySize })` used standalone - keeps it. The
  existing `Content-Length` check is untouched, and the same single header read serves both, so
  nothing is added to the hot path.

  `@miiajs/node-server` owns that slot and applies it when the body is first materialized, so its
  chunked bodies are now counted against the route's own limit. Runtimes whose request is a real
  `Request` have no slot and keep the ceiling: Bun, Deno, both adapters in `mode: 'native'`, and
  anything reached through `app.fetch`, including `TestApp`. `@miiajs/uws-server` will follow.

  Two things worth knowing. Enforcement happens when the body is read - a handler that returns without
  touching a chunked body lets the client upload up to the ceiling regardless. And a malformed
  `Content-Length`, which cannot be judged on its face, is now counted as it arrives rather than
  falling through to the ceiling.

## 0.5.0

### Minor Changes

- [`b496994`](https://github.com/miiajs/miia/commit/b496994ce76d998cc7adf48513233ffd9481fc8a) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - **Breaking: the fourth argument of `app.addRoute()` changed type.** It was `middlewares:
Middleware[] = []`; it is now `options: AddRouteOptions = {}`:

  ```ts
  // before
  app.addRoute("POST", "/upload", handler, [authMiddleware]);

  // after
  app.addRoute("POST", "/upload", handler, { middlewares: [authMiddleware] });
  ```

  Three-argument calls are unaffected. Every four-argument call has to wrap its array as
  `{ middlewares: [...] }` - the array position is gone, not deprecated. TypeScript rejects the old
  form; at runtime an array destructures to no `middlewares`, so the route would silently lose them.

  **One argument shape, not two.** The object is what carries the rest of a route's options -
  `skipGlobalGuards`, `bodyLimit`, and the `skipGlobalPrefix` flag that lands with the global prefix.
  Keeping the array as a second accepted shape would mean every new flag has a call form it cannot be
  expressed in, and `app.addRoute()` would keep drifting from `Router.add()`, which has taken this
  object all along. `AddRouteOptions` is now exported from `@miiajs/core`.

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

## 0.4.0

### Minor Changes

- [`b30ddd3`](https://github.com/miiajs/miia/commit/b30ddd371988dbc27a1c6507c8469bf250ddecac) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add a cookie API to `@miiajs/core`.

  - Fluent writes via `ctx.res.cookie(name, value, options?)` and `ctx.res.deleteCookie(name, options?)` on `ResponseBuilder`. Cookies are appended (multiple `Set-Cookie` headers supported) and mark the response modified so they survive the optimized fast path on node/uws adapters.
  - Lazy `ctx.cookies` jar for reading incoming cookies (`get`, `getAll`, `has`) and writing (`set`, `delete`).
  - New public helpers `serializeCookie`, `parseCookieHeader`, the `CookieJar` class, and the `CookieOptions` type. Supports `httpOnly`, `secure`, `sameSite`, `maxAge` (seconds), `expires`, `domain`, `path`, `priority`, and `partitioned`, with auto-`Secure` for `SameSite=None` and validation on `name`/`path`/`domain` (header injection), `SameSite=None requires Secure`, and `Partitioned requires Secure`.

- [`ef51172`](https://github.com/miiajs/miia/commit/ef511723538e332ca365c47593f4e6e76351b2e2) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Extract `TestApp` into a dedicated `@miiajs/testing` package.

  `TestApp` moved out of `@miiajs/core` (the `@miiajs/core/testing` subpath is removed). Import it from `@miiajs/testing` instead. Core gains a public `Miia.provide(...providers)` method for registering providers without a module.

## 0.3.0

### Minor Changes

- [`cdb17d8`](https://github.com/miiajs/miia/commit/cdb17d8fe4612fdf0f803ff197bf6cdc7cfe5675) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add `@miiajs/rate-limit`: fixed-window rate limiting with a guard flow and a perimeter middleware.

  The primary path is the guard flow: `RateLimitModule.configure({ limit, window })` plus
  `app.useGuard(RateLimitGuard)` for app-wide enforcement, with `@RateLimit(policy)` and
  `@SkipRateLimit()` for per-route control. `@RateLimit` uses replacement semantics, the same
  precedence as `@BodyLimit` (method > class > global) - a decorated route keeps its own bucket
  and does not consume the global quota; `@SkipRateLimit()` disables limiting on its scope. The
  `rateLimit()` middleware is the perimeter form: standalone (no DI) and the only layer that
  covers unmatched routes (404s). Both wrap the same `RateLimiter` core (Upstash-style
  `limit(key)` result object), share a pluggable `RateLimitStore` contract whose `increment()`
  counts the hit and decides blocking atomically (ready for a future Redis Lua store), ship an
  in-memory `MemoryStore`, support `blockDuration` bans, and emit draft-6 `RateLimit-*` headers
  (`legacy` / `false` modes available) with `Retry-After` on 429.

  `blockDuration` also supports optional geometric backoff: `blockBackoff` grows the ban per repeat
  offence (`blockDuration`, `blockDuration × blockBackoff`, ...) up to `maxBlockDuration`, with strikes
  that reset after a `strikeReset` grace period measured from the end of the block. It is opt-in
  (`blockBackoff` defaults to `1`); values above `1` require `maxBlockDuration` to bound escalation.

  To support client keying, `@miiajs/core` gains `ctx.conn` (`ConnInfo` - lazy transport-level
  connection info) and `ctx.ip`, plus a `trustProxy: boolean | string | string[]` app option
  (leftmost `X-Forwarded-For`, a vendor header like `cf-connecting-ip`, or a priority list).
  `@miiajs/node-server` and `@miiajs/uws-server` populate the client address in both optimized
  and native modes. Core also adds `TooManyRequestsException` (429) and a `ip` option on
  `TestApp.request()` for faking the client address in tests.

## 0.2.0

### Minor Changes

- [`7ab341f`](https://github.com/miiajs/miia/commit/7ab341fdcb913253e6be412566aac66e375ad27b) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add framework-level request body size limits.

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

## 0.1.1

### Patch Changes

- [`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Internal: switch `RequestContext` to a class-based shape for V8 hidden-class stability.

  `createContext()` previously allocated a plain object literal per request, which created 7 new closures per request (`query`/`rawQuery` getter/setter pairs plus `json`/`text`/`_setBody` methods). The new `Context` class places those methods on the prototype and uses fixed instance fields, giving V8 a deterministic hidden class to inline-cache against. Public API is unchanged - same `RequestContext` interface, same `json`/`text` caching semantics, same support for custom property attachment (`ctx.user`, `ctx.requestId`, etc.).

## 0.1.0

### Minor Changes

- [`bf9132d`](https://github.com/miiajs/miia/commit/bf9132d16ee802cf1880a61ffd6fa018ee4d9e89) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Initial public release of the MiiaJS framework.
