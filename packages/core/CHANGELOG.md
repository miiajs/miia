# @miiajs/core

## 0.9.0

### Minor Changes

- [`7ff792b`](https://github.com/miiajs/miia/commit/7ff792bb0d238fba145de7fac5332f504a938838) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `cors()` treats only an `OPTIONS` request carrying both `Origin` and `Access-Control-Request-Method` as a preflight, as the Fetch spec defines it, and answers it with 204. Any other `OPTIONS` request goes on to the router - to an `@Options` route, or a 404 - with the CORS headers a simple request from the same origin gets. Before, `cors()` answered every `OPTIONS` from an allowed origin with 204, so an `@Options` route behind it was never reached.

  Breaking: an `OPTIONS` request without `Access-Control-Request-Method` no longer gets a 204 from `cors()` - an app without an `@Options` route for it answers 404.

- [`7ff792b`](https://github.com/miiajs/miia/commit/7ff792bb0d238fba145de7fac5332f504a938838) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `ConsoleLogger` takes a `colors` option (`new Miia({ logger: { colors: false } })`) and leaves ANSI colors out of the text format when `NO_COLOR` is set to a non-empty value, so logs written to a file or collected by `docker logs` carry no escape codes. On Deno the setting comes from `Deno.noColor`, which needs no `--allow-env`. An explicit `colors` wins over `NO_COLOR`; without either, output is colored as before.

- [`7ff792b`](https://github.com/miiajs/miia/commit/7ff792bb0d238fba145de7fac5332f504a938838) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - The router backs up when a branch leads nowhere, as the routing docs describe: with `/users/:id` and `/users/*`, `GET /users/42/posts/1` reaches the wildcard instead of answering 404, and a static segment that dead-ends falls back to a `:param` route at the same position. Priority is unchanged (static > param > wildcard at each segment), and a URL that matches on the first try costs the same single walk as before. Each route also reads its own parameter names: next to `/users/:id`, `/users/:userId/posts/:postId` gets `{ userId, postId }` instead of `{ id, postId }`.

  Breaking: a wildcard now also receives the URLs that more specific routes under it could not finish. A SPA mounted at `/` with `serveStatic(app, '/', dist, { fallback: 'index.html', skipGlobalPrefix: true })` next to an API under `/api` answers an unknown `GET /api/...` with `index.html` (when the client accepts `text/html` or `*/*`) instead of 404. Register a catch-all under the API that throws `NotFoundException` - `app.addRoute('GET', '/*', () => { throw new NotFoundException() }, { skipGlobalGuards: true })` under `globalPrefix: '/api'` - to keep those a 404.

- [`ef974a2`](https://github.com/miiajs/miia/commit/ef974a2e961ad7ced0632ee21a144d4cc324ea27) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `DiscoveryService` returns only what carries a metadata key: new `getClassesWithMeta(key)` (`{ instance, ctor, metadata }` per instance whose class has metadata under `key`, type `DiscoveredClass`) next to `getMethodsWithMeta(key)`. Metadata is read from the class of each instance, so a handler class behind a factory provider is discovered; an instance under two tokens is listed once, and a lazy proxy is skipped. Swagger collects controllers through `getClassesWithMeta(RESOLVED_PREFIX)`. Breaking:

  - `DiscoveryService.getSingletons()` is removed - use `getClassesWithMeta(key)`
  - a factory-provided instance is discovered by its own class, and a plain-object mock (`TestApp.override(Handler, { ... })`) is not discovered at all: its `@On` methods are not subscribed and a mocked controller drops out of the swagger spec - override with a named subclass (`class FakeHandler extends Handler {}`) to keep it
  - calling `getClassesWithMeta()` / `getMethodsWithMeta()` before every provider is constructed (a constructor, a field initializer, `app.get()` without `init()`) throws - call them from `onReady()` or `onInit()`
  - messaging: consumer group names and default idempotency keys come from the class of the handler instance - a factory that returns a subclass for a class token renames the group, and retries parked under the old group are orphaned; the same `@On` class provided twice fails at startup

- [`8672380`](https://github.com/miiajs/miia/commit/8672380da7b04e42bda81f07e6dec2edbc846610) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - The module graph is processed once, on the first `init()`, `app.get()` or `fetch()`, so the order of `register()` calls no longer matters. Breaking:

  - `register()` and `provide()` after the graph is processed throw; a graph that failed to process rethrows its first error on every later `init()` / `app.get()`
  - `use()`, `useGuard()` and `addRoute()` after `init()` throw instead of being picked up by a lazy recompile on the next request
  - a route registered twice (same method and path, param names ignored) throws instead of silently replacing the first
  - `TestApp` collects every builder call and builds the app in `compile()`; builder calls after `compile()`, and `request()` / `resolve()` / `close()` before it, throw

- [`cef184d`](https://github.com/miiajs/miia/commit/cef184d90c66cfd4a7332f28a8921d1dd13a4f9c) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Guards and `Resolver` are checked against module boundaries. A guard declared in a module's `providers` is a provider: a controller in another module uses it once that module exports it and the controller's module imports it, and one passed to `app.useGuard()` must be visible from the root. A guard no module declares - a class put straight into `@UseGuard()` or `app.useGuard()`, `AuthGuard(...)`, `@RateLimit()` - is built once, and what it injects is checked from the module of every controller that uses it, and from the root when it is global. The violations join the start-up report:

  ```text
  AuthGuard(JwtAuth) (guard of UsersController in UsersModule) injects JwtAuth (AuthModule):
    - add JwtAuth to AuthModule `exports`
    - add AuthModule to UsersModule `imports`
  ```

  `inject(Resolver)` returns a resolver bound to the module of the provider that injects it (a factory's `resolve(Resolver)` too, with the host of a `configure()` result); `app.get(Resolver)`, `TestApp.resolve(Resolver)`, `app.provide()` providers and guards no module declares get the one bound to the root. An override of `Resolver` stays one fake for every module. The auth and rate-limit guard classes are named for these messages: `AuthGuard(JwtAuth, ApiKeyAuth)`, `RateLimitGuard`, `RateLimitGuard({...})` and `@RateLimit({...})` - the policy is never printed. Breaking:

  - `Resolver.has()` is `false` for a token the module of the resolver cannot see, and `resolve()` / `resolveOptional()` of one is a boundary violation - in the start-up report during startup, thrown at once after it (`Resolver of PluginsModule resolved ReportsService (ReportsModule), which PluginsModule cannot see:`); `resolveOptional()` returns `null` only for a token nothing registers
  - `Resolver` throws for a request-scoped token even while `ctx.resolve()` builds a request-scoped provider - inject it there instead
  - a guard no module declares fails startup when a module whose controllers use it, or the root for a global one, cannot see what it injects - typically an auth provider: make the module that declares it `global` and export it
  - a guard from the `providers` of one module used by a controller of another fails startup unless it is exported and imported, and so does a guard in `app.useGuard()` that only a module's `providers` declare, until a module passed to `app.register()` exports it

- [`ef974a2`](https://github.com/miiajs/miia/commit/ef974a2e961ad7ced0632ee21a144d4cc324ea27) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `onInit()` and `onReady()` run in dependency order: a provider's hooks run after the hooks of the singletons it resolved while being constructed, otherwise registration order. A factory provider that resolves a dependency lazily (after construction, e.g. through a lazy proxy) lists it in the new `deps` option - `provider(token, factory, { deps })` or `{ token, factory, deps }`; an unregistered token in `deps`, or a cycle that exists only through `deps`, fails `init()` - the cycle with `deps of A lists B: drop that entry, or move the shared logic into a provider both depend on`. An instance registered under several tokens gets each hook once. Global guards from `app.useGuard()` are built with the other singletons, so their field initializers run before any `onInit()`, and they receive `onInit()` too.

- [`8672380`](https://github.com/miiajs/miia/commit/8672380da7b04e42bda81f07e6dec2edbc846610) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - New `createLazyProxy()` export in core. Lazy connection and model proxies no longer resolve when lifecycle hooks are probed - module order no longer breaks `init()`. The proxies are also no longer resolved ahead of time by `init()`, so a failing lookup surfaces on first use (in practice only in hand-built containers: `configure()` registers the `drizzleDb()` / `paprDb()` / `mongooseConnection()` tokens itself).

- [`f16fbc1`](https://github.com/miiajs/miia/commit/f16fbc1e2f12ee5bc5ae28857d61ccbb2199358b) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Module boundaries are checked. A provider sees the providers of its own module, what the modules it imports list in `exports` (re-exports followed) and the exports of `global` modules; built-in tokens and `app.provide()` tokens are visible to every module. Checked from the module of the provider that asks: every `inject()` / `injectOptional()` during construction, every `resolve()` of a factory provider - bound to that provider for life, so a late call from a lazy proxy is checked from it too - and every token in `deps`. A provider registered with `app.provide()` and a global guard no module declares are checked from the root, which sees what the modules passed to `register()` export; the factories of a configured module also see what the module importing it sees. During startup the violations are collected into one report thrown before the first `onInit()`, naming both modules and the fix:

  ```text
  [Miia] 1 module boundary violation:

  OrdersService (OrdersModule) injects UsersService (UsersModule):
    - add UsersService to UsersModule `exports`
    - add UsersModule to OrdersModule `imports`

  Docs: /docs/core-concepts/modules#boundaries
  ```

  "No provider" and both cycle messages name the module next to each token (`required by OrdersService (OrdersModule)`, `required by deps of Lazy (AppModule)`). Breaking:

  - a provider that injects, resolves or lists in `deps` a token its module cannot see fails `init()` (and `app.get()` before it) with the report; the app stays dead after it, so every later `init()`, `app.get()` and request rethrows it
  - an error that ends startup early - a missing provider, a cycle, an error a factory wraps in its own - carries the violations found before it, appended as `Also found N module boundary violations so far:`, with the original error as `cause`
  - a module without `exports`, a `configure()` result included, exports nothing - infrastructure every module injects needs `{ global: true }` or a bare import of the configured class
  - `injectOptional()` of a registered token the module cannot see is a violation instead of `null`
  - after startup a violation throws at once: a transient or request-scoped provider built during a request, or a factory's `resolve()` called later
  - the "No provider" text for `deps` changes from `required by Lazy (deps)` to `required by deps of Lazy (AppModule)`

- [`8672380`](https://github.com/miiajs/miia/commit/8672380da7b04e42bda81f07e6dec2edbc846610) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A configured module is identified by the pair (class, `name`), and a bare `imports: [XModule]` resolves to the module's configuration wherever it sits in the graph, regardless of order - before, a bare import reached first silently dropped the `configure()`. `TestApp.override()` builds an override descriptor (`overrideProvider()` / `overrideModule()`, exported from core) that goes through `register()` and replaces one entry, instead of racing `provide()` against the modules; `override(XModule, XModule.configure(test))` replaces a configured module. Breaking:

  - two `configure()` calls of the same module without a `name` throw `[Miia] X is configured twice (A, B) - configure it once; a module that takes a name can be configured again under a different one` instead of the first one silently winning
  - `TestApp.override()` of a token that no loaded module provides and that is not in the container throws on `compile()`; so does an override of a module the graph does not configure
  - overriding a guard that is not declared in a loaded module's `providers` no longer works - declare the guard in `providers`

- [`f16fbc1`](https://github.com/miiajs/miia/commit/f16fbc1e2f12ee5bc5ae28857d61ccbb2199358b) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - New `forwardRef(() => X)` (type `ForwardRef`) for module files that import each other: written on both sides of the cycle, in `imports` or `exports`, it defers the reference until the graph loads. New module options `exports` and `global` on `@Module()` and on `ConfiguredModule` - the loader records them and checks `exports`, and module boundaries are checked against them. Breaking:

  - `exports` may list only the module's own providers and modules it imports: `[Miia] UsersModule exports MailService, which it neither provides nor imports`
  - one `configure()` result imported by two modules (or by a module and `register()`) throws `[Miia] The same configured module X is imported by A and B` instead of being shared - import it once and re-export it, or make it global
  - the same provider in two modules throws `[Miia] MailService is provided by both UsersModule and OrdersModule` (configured modules are named with their host), and a provider listed twice in one module throws `[Miia] MailService is listed twice in UsersModule providers` - both replace `Duplicate provider: X is already registered`
  - `provide()` of a token a loaded module declares throws `[Miia] provide(X): X is declared by XModule - replace it with override() instead` instead of the module declaration being skipped
  - a module override inherits `global` from the configuration it replaces; a replacement that sets a different `global` throws
  - an `undefined` in `imports` / `exports`, or a `forwardRef()` that returns something other than a module, throws with the `forwardRef` advice

- [`c0b1422`](https://github.com/miiajs/miia/commit/c0b1422b885574d3d604f5cfbe3c72e997967895) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A DI token is a class (abstract ones included) or a `createToken()` object. Breaking:

  - string tokens are gone from `inject()`, `injectOptional()`, `app.get()`, `ctx.resolve()`, `Resolver`, factory providers and `TestApp.override()` / `TestApp.resolve()` - replace `'API_KEY'` with `createToken<string>('API_KEY')`
  - `@Injectable({ token })` is removed - register the class itself, or a `provider(token, ...)` for a token object
  - `Container` and `runInContainerContext` are no longer exported from `@miiajs/core` - build an app with `new Miia().provide(...)` / `register(...)` and read providers with `app.get()`, or use `TestApp`

- [`cef184d`](https://github.com/miiajs/miia/commit/cef184d90c66cfd4a7332f28a8921d1dd13a4f9c) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Request-scoped providers get the context of their request and a cleanup hook. `REQUEST_CONTEXT` is a built-in request-scoped token: `inject(REQUEST_CONTEXT)` in a request-scoped class, `resolve(REQUEST_CONTEXT)` in a request-scoped factory. Like any request-scoped token, a singleton or transient cannot inject it, and `app.get()` / `Resolver` throw for it. Every request seeds its own, so `provide()` and `override()` of it, and a module that declares it in `providers` (`[Miia] AppModule declares REQUEST_CONTEXT in providers - ...`), throw - test a request-scoped provider through a route, or override that provider itself.

  Once the pipeline of a request has finished and its response is built, the instances the request created get `onDestroy()`, newest first. The hooks do not hold the response back, and one that throws is logged while the rest still run. A singleton a request-scoped factory returns, a lazy proxy and the context itself are not destroyed. A request that reaches only singletons and transients through `ctx.resolve()` allocates no scope. `app.destroy()` waits for these hooks of the requests that finished before it started - one that ended in the same tick included - before any `onShutdown()`, so they still see working singletons; a request still running, or arriving through `app.fetch` during shutdown, is not waited for. Breaking:

  - `ctx.resolve()` of a request-scoped token after the request's pipeline has finished throws (`[Miia] Request-scoped X was resolved after its request finished (e.g. from a streaming response) - resolve it in the handler before returning`); singletons and transients still resolve. A streaming response resolves what it needs in the handler
  - a request-scoped instance with an `onDestroy()` method now has it called at the end of every request

- [`8672380`](https://github.com/miiajs/miia/commit/8672380da7b04e42bda81f07e6dec2edbc846610) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Request-scoped providers live on the request context, so concurrent requests no longer share or swap instances. Breaking:

  - reach a request-scoped provider with the new `ctx.resolve(Token)`; another request-scoped provider can still `inject()` it
  - a singleton or transient that injects a request-scoped provider throws (a singleton at startup), naming both sides
  - `app.get()` and `Resolver.resolve()` of a request-scoped token throw outside a request
  - controllers and guards must be singletons
  - `Container.clearRequestScope()` is removed

- [`9e6b1ae`](https://github.com/miiajs/miia/commit/9e6b1aedef64d997314a636f31c93d075fdc5c65) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Shared providers. `provider(token, factory, { shared: key })` lets several modules declare the same token, each with a provider marked by the same key, and get one instance: the first declaration builds it, every declaring module owns it and may export it, and what its factory injects is checked against module boundaries from each of them, whatever the order of `imports`. Its `inject(Resolver)` / `resolve(Resolver)` gets one resolver over all of them: `has()` is `true` only for a token every one of them sees, and `resolve()` reports a violation from each one that cannot see it. A different key throws `[Miia] X is shared by A (k1) and B (k2) - a shared provider must be declared the same way in every module; use a separate token for each variant`; an unmarked declaration next to a marked one is still `provided by both`. papr and mongoose `register()` mark their models with the connection (`the default connection`, `connection 'analytics'` - the unnamed connection and one named `'default'` are two connections), so several feature modules can `register([User])` and share one model instead of failing with `provided by both` - each of them must see `PaprModule` / `MongooseModule` itself. Breaking:

  - the same model token registered on two connections (`register([User])` and `register([User], { name: 'analytics' })`) throws at startup (`... (the default connection) and ... (connection 'analytics')`) instead of logging a `console.warn` - the warning was process-wide, the check is now per app; use a separate `defineModel(...)` per connection

- [`ef974a2`](https://github.com/miiajs/miia/commit/ef974a2e961ad7ced0632ee21a144d4cc324ea27) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - New `onShutdown()` lifecycle hook. `destroy()` closes the server, then runs `onShutdown()` on every singleton (stop taking new work, wait for work in flight, stay usable), then `onDestroy()` on every singleton (release resources), both in reverse dependency order. A failing hook or server close no longer stops the rest: `destroy()` runs every step, logs each failure with its source (`X.onDestroy() failed during shutdown`) and throws afterwards - the error itself for one failure, an `AggregateError` for several. A `destroy()` called while one is running gets the same promise instead of running the hooks twice, and a later one does not close the server again.

- [`c0b1422`](https://github.com/miiajs/miia/commit/c0b1422b885574d3d604f5cfbe3c72e997967895) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Typed DI tokens. `createToken<T>(name, { hint? })` makes a token object whose type flows into `inject()`, `injectOptional()`, `app.get()`, `ctx.resolve()` and `Resolver`; an abstract class works as a token too. `provider(token, factory, { scope?, deps?, shared? })` builds a factory provider checked against the token's type. `hint` on `createToken()` or `@Injectable({ hint })` adds a line to "No provider" errors naming what provides the token, and a second line when another token with the same name and hint is registered - the token is defined twice on purpose (two `defineModel('User', ...)` calls, one per connection) or a package is installed twice: `register this one too if both are intended, otherwise deduplicate the package that defines it`. New exports: `createToken`, `provider`, types `Token`, `AbstractConstructor`, `AnyToken`. `TestApp.override()` and `TestApp.resolve()` are typed from the token: `override()` takes a partial mock of the token's type or a function returning one.

### Patch Changes

- [`7ff792b`](https://github.com/miiajs/miia/commit/7ff792bb0d238fba145de7fac5332f504a938838) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - On Bun a request whose `Host` header is not a plain host (`x/y`, `x?q`, empty) reaches `app.fetch` with a relative `req.url`, and the router dropped the first segment of its path: `GET /foo/admin/x` was routed to `/admin/x`. Such a request is now routed by its whole path.

- [`af754d3`](https://github.com/miiajs/miia/commit/af754d31d3e19acb7551c8716c4b007ad2b62705) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A bundled app keeps its decorator metadata. `"sideEffects": false` let a bundler drop core's `Symbol.metadata` polyfill, so `wrangler`, `bun build` and esbuild produced an app that answered 404 on every route, or failed at start with `Cannot set properties of undefined` when a package compiled with `tsc` was in the bundle. The list now names `./dist/polyfill.js`, and the rest of the package stays tree-shakable.

- [`7ff792b`](https://github.com/miiajs/miia/commit/7ff792bb0d238fba145de7fac5332f504a938838) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A handler that sets its own `Content-Type` and returns a value now sends that value. `ctx.res.header('content-type', 'application/vnd.api+json'); return { custom: true }` used to answer 200 with an empty body, because a returned value was serialized only while no `Content-Type` was set; it now goes out as JSON under the handler's `Content-Type` (a returned string is JSON-encoded too - use `ctx.res.text()` or return a `Response` for a raw body). What decides is whether the response already has a body: one set with `ctx.res.json()`, `text()`, `html()` or `stream()` wins over the returned value. With no `Content-Type` set the value goes out as `application/json`, as before; a HEAD request gets the `Content-Type` a GET would, with no body.

- [`7ff792b`](https://github.com/miiajs/miia/commit/7ff792bb0d238fba145de7fac5332f504a938838) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `cors()` with any `origin` but `'*'` adds `Origin` to `Vary` on every response. A list or a predicate used to send no `Vary` when the request's origin was refused or missing, so a shared cache could keep that answer, without `Access-Control-Allow-Origin`, and hand it to an allowed origin. `Origin` is appended to a `Vary` an earlier middleware set instead of replacing it, and is not added again when `Vary` already lists it or is `*`.

- [`23d1f67`](https://github.com/miiajs/miia/commit/23d1f674d8900dd1d62f4f15e90db8c46494519e) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Faster 404s and middleware pipelines. An app without global middleware answers an unmatched route without building a `NotFoundException`, with the same 404 response as before. Under global middleware the `NotFoundException` a middleware can catch is built without collecting a stack on Node and Deno: its `stack` is the first line, `NotFoundException: Cannot GET /x` (on Bun it is collected as before). `compose()`, and every route and global pipeline built on it, no longer wraps each level in an async function: a middleware that throws synchronously still rejects the returned promise and a second `next()` still rejects with `next() called multiple times`, while the promise now resolves to whatever the first middleware returned, as in koa-compose. Static routes are looked up per method without building a key per request.

  A HEAD request never serializes the handler's return value, behind route or global middleware too, and a body the handler already set (`ctx.res.stream()`, `ctx.res.text()`) keeps the Content-Type it has on GET: HEAD no longer adds `application/json` next to a stream.

- [`b88e9cc`](https://github.com/miiajs/miia/commit/b88e9ccdb4662d7195c0ba7beff3fec17ba2436f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - The `logger` option of `new Miia()` replaces the process-wide logger only while the app lives: `destroy()` puts back the logger it replaced, unless another one has been installed since. A `TestApp` (`logger: false`) used to silence `Logger` for the rest of the process; after `close()` logging works again.

- [`7ff792b`](https://github.com/miiajs/miia/commit/7ff792bb0d238fba145de7fac5332f504a938838) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A subclass controller that overrides a handler and puts route decorators on the override now replaces the routes and the `body` / `query` / `params` schemas that handler inherited, instead of adding to them. Repeating the parent's route no longer fails at startup with a route conflict, a different schema or a body schema on a handler the parent served with GET no longer throws a `TypeError` when the class is defined, and moving the route to another path no longer leaves the old one served. An override without route decorators keeps the inherited routes and schemas as before. Guards and middleware still add to the parent's, `@Status` and `@BodyLimit` are inherited until the override sets its own, and `@SkipGuard` on the override drops a guard the parent declared.

- [`7ff792b`](https://github.com/miiajs/miia/commit/7ff792bb0d238fba145de7fac5332f504a938838) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `app.provide(Class)` registers the class in the scope its `@Injectable({ scope })` declares, as a module's `providers` does. It always made a singleton, so a `transient` or `request` class provided this way was shared.

- [`b88e9cc`](https://github.com/miiajs/miia/commit/b88e9ccdb4662d7195c0ba7beff3fec17ba2436f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A handler that returns `ctx.res` gets the response it built. `return ctx.res.redirect('/login')` used to answer the redirect with the builder itself serialized as a JSON body (`{"_status":302,...}`), and a bare `return ctx.res` answered 200 with that JSON; a returned `ctx.res` now counts as no result, the same as returning nothing, so `return ctx.res.status(201).json(user)` and `return ctx.res.redirect(url)` both work.

- [`7ff792b`](https://github.com/miiajs/miia/commit/7ff792bb0d238fba145de7fac5332f504a938838) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - The start-up log lists every route the app serves, not only controller routes: `app.addRoute()`, `serveStatic()` and routes a provider adds from `onReady()` (the `@miiajs/swagger` endpoints) appear too, at the path they are served at. The lines come from the router (context `Router`), and a module configured under a name is logged as `DrizzleModule (name 'analytics') dependencies initialized`.

- [`07bd7fd`](https://github.com/miiajs/miia/commit/07bd7fda677fab361dfb39771555b93ad07e8354) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `ctx.res.text()` and `ctx.res.html()` send `charset=utf-8` with their content type (`text/plain; charset=utf-8`, `text/html; charset=utf-8`). Without it a browser reads `text/plain` as windows-1252 and garbles anything outside ASCII; `@miiajs/serve-static` already labels the same types this way.

- [`8672380`](https://github.com/miiajs/miia/commit/8672380da7b04e42bda81f07e6dec2edbc846610) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - DI errors name the token instead of printing class source, show the dependency chain for cycles and who required a missing provider.

- [`f34144d`](https://github.com/miiajs/miia/commit/f34144d52e541f85bebfcd6860a0a4f0d0aede25) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A subclass decorated with `@Get`, `@Use`, `@UseGuard`, `@SkipGuard`, `@Status`, `@BodyLimit`, `@On` and other decorators built on the metadata helpers no longer writes into its parent's metadata: `pushMeta()`, `addToMapMeta()`, `setInMapMeta()` and `@SkipGuard` copy an inherited array or `Map` before writing, so the subclass sees the parent's entries plus its own and a parent controller no longer gets its subclass's routes.

- [`f34144d`](https://github.com/miiajs/miia/commit/f34144d52e541f85bebfcd6860a0a4f0d0aede25) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A module class with its own `@Module` providers, controllers or imports can be configured under several names. Each of its providers is one instance shared by every name, and what it injects - `inject()`, a factory's `resolve()` and `deps`, and the `Resolver` it gets, which covers every name - is checked against module boundaries from each of them. Its controllers are mounted once, with their guards checked from every name, and a `configure()` result in its `imports` is imported once.

## 0.8.0

### Minor Changes

- [`3ed3fb2`](https://github.com/miiajs/miia/commit/3ed3fb2178fc3489d99c5317e7deaa075aed0086) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Answer malformed JSON with 400 everywhere and read an empty body as no body

  `ctx.json()` now reads the body through `ctx.text()` and parses it itself. A non-empty body that is not valid JSON
  rejects with `BadRequestException` (400, `Malformed JSON body`) on every route. Before, a route without a schema
  answered 500 and a route with a `body` schema answered 422 (`Body validation failed`); the schema no longer runs on
  such a body.

  An empty body, or none at all (a GET, a HEAD), makes `ctx.json()` resolve to `undefined` instead of rejecting with a
  `SyntaxError` that ended in a 500. On a route with a `body` schema the schema gets `undefined`, so a required object
  answers 422. Code that relied on `ctx.json().catch(() => fallback)` for an empty body now gets `undefined` rather than
  the fallback; use `(await ctx.json()) ?? fallback` instead.

  `ctx.json()` and `ctx.text()` share one read of the body, so they can be called in any order on the same request on
  every runtime. Before, the second call threw `body already used` on Bun, Deno and streaming bodies. After a `body`
  schema runs, `ctx.json()` returns the validated data while `ctx.text()` returns the raw text. The raw stream
  (`ctx.req.body`, `ctx.req.formData()`, `ctx.req.arrayBuffer()`) is still available only before the first call to
  either helper.

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

- [`5db0281`](https://github.com/miiajs/miia/commit/5db02816b14ba46dade720ab55360235bbdca493) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Map Bun's oversized-body error to 413 inside the app

  Bun rejects a body over `maxRequestBodySize` with a plain `Error`. Core now recognises it by its message and turns it
  into `PayloadTooLargeException` (413) in `ctx.text()`, `ctx.json()` and the error handler. A route with a `body` schema
  no longer runs the schema on `null` and answers 422, and multipart (`ctx.parts`, `ctx.form()`) and raw reads
  (`ctx.req.arrayBuffer()`, `ctx.req.body`) no longer log an unhandled error and build a 500. The client already got
  Bun's own 413; this changes what the app sees.

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
