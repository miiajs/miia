# @miiajs/testing

## 0.9.0

### Minor Changes

- [`8672380`](https://github.com/miiajs/miia/commit/8672380da7b04e42bda81f07e6dec2edbc846610) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - The module graph is processed once, on the first `init()`, `app.get()` or `fetch()`, so the order of `register()` calls no longer matters. Breaking:

  - `register()` and `provide()` after the graph is processed throw; a graph that failed to process rethrows its first error on every later `init()` / `app.get()`
  - `use()`, `useGuard()` and `addRoute()` after `init()` throw instead of being picked up by a lazy recompile on the next request
  - a route registered twice (same method and path, param names ignored) throws instead of silently replacing the first
  - `TestApp` collects every builder call and builds the app in `compile()`; builder calls after `compile()`, and `request()` / `resolve()` / `close()` before it, throw

- [`8672380`](https://github.com/miiajs/miia/commit/8672380da7b04e42bda81f07e6dec2edbc846610) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A configured module is identified by the pair (class, `name`), and a bare `imports: [XModule]` resolves to the module's configuration wherever it sits in the graph, regardless of order - before, a bare import reached first silently dropped the `configure()`. `TestApp.override()` builds an override descriptor (`overrideProvider()` / `overrideModule()`, exported from core) that goes through `register()` and replaces one entry, instead of racing `provide()` against the modules; `override(XModule, XModule.configure(test))` replaces a configured module. Breaking:

  - two `configure()` calls of the same module without a `name` throw `[Miia] X is configured twice (A, B) - configure it once; a module that takes a name can be configured again under a different one` instead of the first one silently winning
  - `TestApp.override()` of a token that no loaded module provides and that is not in the container throws on `compile()`; so does an override of a module the graph does not configure
  - overriding a guard that is not declared in a loaded module's `providers` no longer works - declare the guard in `providers`

- [`c0b1422`](https://github.com/miiajs/miia/commit/c0b1422b885574d3d604f5cfbe3c72e997967895) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A DI token is a class (abstract ones included) or a `createToken()` object. Breaking:

  - string tokens are gone from `inject()`, `injectOptional()`, `app.get()`, `ctx.resolve()`, `Resolver`, factory providers and `TestApp.override()` / `TestApp.resolve()` - replace `'API_KEY'` with `createToken<string>('API_KEY')`
  - `@Injectable({ token })` is removed - register the class itself, or a `provider(token, ...)` for a token object
  - `Container` and `runInContainerContext` are no longer exported from `@miiajs/core` - build an app with `new Miia().provide(...)` / `register(...)` and read providers with `app.get()`, or use `TestApp`

- [`c0b1422`](https://github.com/miiajs/miia/commit/c0b1422b885574d3d604f5cfbe3c72e997967895) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Typed DI tokens. `createToken<T>(name, { hint? })` makes a token object whose type flows into `inject()`, `injectOptional()`, `app.get()`, `ctx.resolve()` and `Resolver`; an abstract class works as a token too. `provider(token, factory, { scope?, deps?, shared? })` builds a factory provider checked against the token's type. `hint` on `createToken()` or `@Injectable({ hint })` adds a line to "No provider" errors naming what provides the token, and a second line when another token with the same name and hint is registered - the token is defined twice on purpose (two `defineModel('User', ...)` calls, one per connection) or a package is installed twice: `register this one too if both are intended, otherwise deduplicate the package that defines it`. New exports: `createToken`, `provider`, types `Token`, `AbstractConstructor`, `AnyToken`. `TestApp.override()` and `TestApp.resolve()` are typed from the token: `override()` takes a partial mock of the token's type or a function returning one.

### Patch Changes

- [`b88e9cc`](https://github.com/miiajs/miia/commit/b88e9ccdb4662d7195c0ba7beff3fec17ba2436f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A `compile()` that throws destroys the app it built before rethrowing, so the global logger it silenced with `logger: false` comes back even though the test never reaches `close()`.

## 0.8.0

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

### Minor Changes

- [`ef51172`](https://github.com/miiajs/miia/commit/ef511723538e332ca365c47593f4e6e76351b2e2) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Extract `TestApp` into a dedicated `@miiajs/testing` package.

  `TestApp` moved out of `@miiajs/core` (the `@miiajs/core/testing` subpath is removed). Import it from `@miiajs/testing` instead. Core gains a public `Miia.provide(...providers)` method for registering providers without a module.
