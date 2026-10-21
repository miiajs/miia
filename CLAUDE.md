# MiiaJS

Lightweight, decorator-driven HTTP framework for TypeScript. Inspired by Angular/NestJS architectural ideas - decorator-driven DI, controllers, modules - Koa's onion-model middleware, and Hono's multi-runtime, lightweight philosophy. Built from scratch on modern standards.

## Philosophy

- **Web Standards first** - Request/Response API, no Express/Fastify lock-in
- **TC39 native decorators** - no reflect-metadata, no experimental flags
- **ESM-only** - ES2025 target, `nodenext` module resolution, `verbatimModuleSyntax`
- **Runtime-agnostic** - Bun, Deno natively; Node.js/uWebSockets via server packages
- **Runtime defects: work around only when it pays** - a defect of Deno, Bun, uWS or Node is worked around only when it would otherwise crash the process, leak memory or hang, or when the workaround is cheap (a few lines, nothing on the hot path); the rest is documented and reported upstream. Defects of our own adapters are fixed
- **Minimal abstractions** - Koa-style middleware replaces interceptors/pipes/filters. One concept, full power
- **Module boundaries over one container** - per-app container; `imports` / `exports` / `global` checked at startup, nothing global by default
- **Lightweight schemas** - use Drizzle/Papr/Mongoose schemas directly, no decorator-based ORM layer

## Monorepo structure

```
packages/
  core/          - DI, decorators, router, middleware, exceptions, response, cors, logger
  config/        - ConfigModule, ConfigService, validated env via Zod
  serve-static/  - Static file serving (Range, ETag, charset, SPA fallback, dotfile guard)
  node-server/   - Node.js HTTP server (optimized + native modes)
  uws-server/    - uWebSockets.js HTTP server (optimized + native modes)
  auth/          - AuthProvider interface, AuthGuard, token extractors
  jwt/           - JwtModule + JwtService (sign/verify via jose)
  rate-limit/    - Fixed-window rate limiting: rateLimit middleware, RateLimitGuard, @RateLimit/@SkipRateLimit, pluggable stores
  multipart/     - Streaming multipart/form-data: @Multipart, ctx.parts, ctx.form(), form validation via route body schema
  drizzle/       - Drizzle ORM integration (postgres/mysql/sqlite)
  papr/          - MongoDB integration via Papr
  mongoose/      - MongoDB integration via Mongoose
  swagger/       - OpenAPI 3.1 spec generation, Swagger UI serving
  messaging/         - Decorator-driven message bus (event-bus pattern), retry, DLQ, idempotency, named buses, W3C tracing
  messaging-redis/   - Redis Streams transport for messaging (consumer groups, PEL-backed retry)
  testing/       - TestApp harness for integration tests
  cli/           - CLI: new, add, generate, dev, build, start, check; project templates in cli/templates/
  create-miia/   - bun create miia / npm create miia: runs miia new
examples/
  drizzle-app/   - CRUD with Drizzle + PostgreSQL
  papr-app/      - CRUD with Papr + MongoDB
  mongoose-app/  - CRUD with Mongoose + MongoDB
  full-app/      - Full stack example using auth, drizzle, jwt, swagger, serve-static, multipart
  messaging-app/ - Event-driven orders flow with @miiajs/messaging + Redis Streams transport
  uws-app/       - Minimal CRUD on @miiajs/uws-server (Node-only)
apps/
  website/       - Documentation site (Nuxt 4)
```

Benchmarks live in a separate repo: [github.com/miiajs/benchmarks](https://github.com/miiajs/benchmarks).

## Tooling

- **Package manager:** Bun (`bun install`, `bun add`)
- **Test runner:** Bun (`bun test`), tests import from `bun:test`
- **Build:** `tsc --build` with composite project references (`tsconfig.build.json`)
- **Formatter:** Biome - single quotes, trailing commas, semicolons as needed (`biome.json`)
- **Git hooks:** Lefthook - pre-commit auto-formats staged files (`lefthook.yml`)
- **Root scripts:** `build`, `build:watch`, `clean`, `test`, `typecheck`, `format`, `format:check`

## Key patterns

### DI: per-app container with inject()

Each `Miia` instance owns its own `Container` - internal to core, not exported (core tests import it from `../src/di-container.js`). Use `inject(Token)` in a field initializer to resolve dependencies from the active container during class instantiation. Modules draw boundaries over that one container (see Module system below): what a provider may inject depends on its module's `imports` and the `exports` of those.

Tokens are classes (abstract ones included) or typed objects from `createToken<T>(name, { hint? })` - the value type flows from the token into `inject()` / `app.get()` / `ctx.resolve()` / `TestApp.override()`, `provider(token, factory, { scope?, deps?, shared? })` checks a factory provider against it, and `hint` (also `@Injectable({ hint })`) tells a "No provider" error which module provides the token and, when another token with the same name and hint is registered, says it is either defined twice on purpose (register this one too) or a duplicated package.

Three scopes: `singleton` (default), `transient` (new instance per resolve), `request` (one instance per HTTP request, kept on the request context and reached with `ctx.resolve(Token)`). Only another request-scoped provider may `inject()` a request-scoped one: a singleton that does fails at startup, a transient when constructed. `app.get()` throws for a request-scoped token, and `Resolver` always does, even inside a request. The built-in request-scoped `REQUEST_CONTEXT` is the context itself (`inject()` in a request-scoped class, `resolve()` in its factory) - `provide()` / `override()` of it and a module that declares it in `providers` throw (any other built-in a module declares keeps the built-in); the scope `Map` is created on the first request-scoped resolve, seeded with it, so `ctx.resolve()` of singletons and transients allocates nothing. Every pipeline end builds the response, then calls `ctx._endScope()` (one write of the `CLOSED` sentinel; the fast path in its existing `.then`/`.catch`, the pipelines in `finally`). `destroyRequestScope()` collects the instances the request owns synchronously - not the context itself, a singleton a request factory returned (a `WeakSet` of singletons), or a lazy proxy - and with none nothing is scheduled; otherwise one `queueMicrotask` runs their `onDestroy()` newest first, each error logged under `RequestScope` (a throwing logger is swallowed), and only after a hook that returns a thenable do the rest continue, as one async chain per request for all the remaining hooks (`awaitRequestDestroy()`, never rejects), tracked in a `Set`. `destroyAll()` settles them first, before `onShutdown()`: `await null` (the microtask of a request that ended in the same tick runs first and registers its chain - nothing is added on the hot path), then one `Promise.all` over a snapshot of the `Set`, no `while` - only requests whose pipeline finished before shutdown started (requests that keep arriving through `app.fetch` with no server to close cannot hold it), no timeout. `ctx.resolve()` of a request-scoped token after that throws (`... was resolved after its request finished`), so a streaming response must resolve in the handler. Controllers and guards are built once and must be singletons.

Lifecycle hooks via duck-typing (no interface required), four of them: `onInit(): Promise<void>` called during `container.initAll()`, `onReady()` during `container.bootstrapAll()`, `onShutdown()` and then `onDestroy()` during `container.destroyAll()`. `onInit()` / `onReady()` run in dependency order - a singleton after the singletons it resolved while being constructed and those in its factory provider's `deps` (for a dependency the factory reaches lazily, e.g. through a lazy proxy), otherwise registration order - once per instance. Shutdown runs in reverse dependency order and in two phases: `onShutdown()` on every singleton (stop taking new work, wait for work in flight, stay usable), then `onDestroy()` on every singleton (release resources); a failing hook does not stop the rest. Transients get no hooks; request-scoped instances get only `onDestroy()`, at the end of their request (above), and `app.destroy()` waits for those of requests that finished before it started, before `onShutdown()`. A `destroy()` called while one is running gets the same promise (`destroying`, cleared when it settles, so a later call runs again).

### Decorators: Symbol.metadata

`@Injectable`, `@Controller`, `@Module` store metadata via TC39 `Symbol.metadata` (polyfilled in `@miiajs/core`). No WeakMaps, no pending drain.

Metadata helpers: `getMeta()`, `setMeta()`, `pushMeta()`, `addToMapMeta()`, `setInMapMeta()`. A subclass's metadata inherits its parent's through the prototype chain, so the write helpers copy an inherited array/`Map` before writing (a subclass never changes its parent's metadata); a decorator writing `context.metadata[key]` by hand must do the same (`Object.hasOwn`, copy, write).

External packages use decorator creators for custom decorators:
- `createClassDecorator()` - class-level (e.g. `@ApiTag`)
- `createMethodDecorator()` - method-level (e.g. `@ApiOperation`)
- `createFieldDecorator()` - field-level
- `createDecorator()` - dual class/method (e.g. `@SkipGuard`, `@ApiSecurity`)

### Module system: @Module and dynamic modules

`@Module({ imports, controllers, providers, exports, global, prefix })` groups related functionality. Modules can import other modules recursively; a cycle in the module graph is fine for the loader, but circular imports between files hit the TDZ, so the edge of such a cycle is written `forwardRef(() => X)` on both sides (in `imports` and `exports`; the loader calls it once and expects a module class or a `configure()` result). An `undefined` in `imports` / `exports` throws `[Miia] X imports undefined (index N)` with that advice. `prefix` composes with controller prefixes via `joinPaths()`.

`app.register()` only collects modules: the graph is processed once, on the first `init()` / `app.get()` / `fetch()`, so the order of `register()` calls does not matter. After that point `register()` / `provide()` throw; `use()` / `useGuard()` / `addRoute()` throw once `init()` has started. A graph that failed to process rethrows its first error on every later `init()` / `app.get()`.

**Boundaries.** A token is visible from a module that declares it, imports a module that exports it (re-exports followed - `exports` may list imported modules), or when a `global: true` module exports it; built-ins and `app.provide()` tokens are visible to all. Requesters are checked from their module: every `inject()` / `injectOptional()` during construction, a factory's `resolve` (bound to its entry for life - a late call from a lazy proxy is checked from that entry, S4 too) and `deps` tokens. No module (`app.provide()`, a global guard no module declares) means the virtual root, which imports what `register()` got; a configured module's factories also see what its host sees. `injectOptional()` of a registered but invisible token is a violation, not `null`. During startup (`init()`: graph + `constructAll()`; `app.get()` before `init()`) violations go into one report (`[Miia] N module boundary violations:`, `Docs: /docs/core-concepts/modules#boundaries`) thrown before the first `onInit()`, or appended to whatever error ends startup (`Also found N ... so far`); either one leaves the app dead (every later `init()` / `get()` / `fetch()` rethrows it). After startup a violation throws at once. Not checked: `app.get()`, `TestApp.resolve()`, `ctx.resolve()` themselves (what they build is) and Discovery.

**Guards and `Resolver` across boundaries.** A guard in `providers` is a provider: the module of a controller that uses it must see the guard class (`UsersController (UsersModule) uses PostsGuard (PostsModule):`), and one in `app.useGuard()` must be visible from the root (`exports` of a module passed to `register()`). A guard no module declares (`AuthGuard(...)`, `@RateLimit`, a bare class in `@UseGuard` / `useGuard()`, registered by `registerGuard()` with `guard: true`) is one instance: its direct `inject()`s are recorded in `entry.injected` instead of checked, and `checkGuard()` checks them from the module of every controller that uses it, once per (guard, module) - `AuthGuard(JwtAuth) (guard of UsersController in UsersModule) injects JwtAuth (AuthModule):` - and from the root for `useGuard()` (`checkGlobalGuards()` right after `constructAll()`, same report); a guard from `app.provide()` is visible to all. `inject(Resolver)` (and a factory's `resolve(Resolver)`) returns a resolver bound to the requester's module, one per module node: `has()` is registered and visible, `resolve()` / `resolveOptional()` of a registered token the module cannot see is a violation (`Resolver of PluginsModule resolved ReportsService (ReportsModule), which PluginsModule cannot see:`), unregistered -> `null` for `resolveOptional()`. Requesters without a module, guards no module declares and `app.get(Resolver)` / `TestApp.resolve(Resolver)` get the built-in one, bound to the root. An override of `Resolver` replaces the built-in entry and is one fake for every module. Not covered: what a guard no module declares reaches through another such guard, and a guard built with `new` outside the container.

Dynamic module pattern for runtime configuration:
```ts
DrizzleModule.configure((resolve) => {
  const config = resolve(ConfigService)
  return { dialect: 'postgres', connection: { url: config.getOrThrow('DATABASE_URL') } }
})
```
`configure()` returns a `ConfiguredModule` - a module class with extra providers, `exports` (without them it exports nothing) and `global`, merged with the class's own `@Module`. Packages take `{ global: true }` in the second argument of `configure()`; a feature module reaches a non-global unnamed configuration with a bare `imports: [XModule]`. `register()` adds schemas/models to an existing module's registry.

A configured module's identity is the pair (class, `name`), labelled `X (name 'n')` in errors and in the start-up `dependencies initialized` log: the loader collects every configuration in a pre-pass before registering providers, so a bare `imports: [XModule]` anywhere resolves to the unnamed configured one regardless of order, and two configurations of one pair throw `[Miia] X is configured twice (A, B)`. One `configure()` result has one host - the module whose `imports` hold it, or `register()`: the same object imported by two modules throws `[Miia] The same configured module X is imported by A and B` (import it once and re-export it, or make it global). A class configured under several names shares its own `@Module` parts: its `providers` are one container entry owned by every name (an entry can have several owning modules - `owners`, `owner` is the first - and every check of what it injects, `inject` / factory `resolve` / `deps`, runs from each of them; its `inject(Resolver)` gets one resolver over all owners - `ResolverView` is a module list, cached by the entry's live `owners` array - whose `has()` needs every owner to see the token and whose `resolve()` records a violation per owner that does not), its `controllers` are mounted once (two prefixes throw) and their guards are checked from every name (phase 2 passes `mounted.owners` through `RoutesResolver.resolve()` into `RouterExplorer.explore()`), and a `configure()` result in its `imports` has one host, the first name; the providers of each `configure()` result stay per name (a duplicate still throws). The DB packages set `name` on their named variants (`DrizzleModule.configure(opts, { name: 'analytics' })` is `{ module: DrizzleModule, name: 'analytics' }`), so a second configuration of that name throws too and `overrideModule()` can replace it; papr/mongoose `register()` still returns a new anonymous module per call. `provider(token, factory, { shared: key })` (the key sits under the internal `SHARED_PROVIDER` symbol of `di-token.ts`, not exported from the index) lets several modules declare one token with the same key and share one entry: the first declaration builds it, the rest join as owners (`addOwner`), so each may export it and checks run from each; a different key throws `[Miia] X is shared by A (k1) and B (k2) - ...`, a marked declaration next to an unmarked one is still `provided by both`, and the key of the first declaration is recorded before an override applies.

### Routing: trie-based router

`Router` uses a trie structure. Static paths: O(1) lookup. Dynamic paths with `:param` or `*wildcard`: trie traversal, static > param > wildcard at each segment; when the chosen branch dead-ends the lookup backs up to the next option (`matchTrie()` walks the best branch once, `search()` runs only after a miss below a node with a lower-priority option and visits each node at most once), so a SPA wildcard at `/` answers unknown `/api/...` GETs unless a `GET /api/*` catch-all with `skipGlobalGuards: true` throws `NotFoundException` (recipe in the serve-static docs). Param names live on the route entry, not the shared param node: `/u/:id` and `/u/:userId/posts` each read their own. HEAD falls back to GET - lookup order static HEAD, static GET, HEAD trie, GET trie (both tries back up); no 405. A route registered twice - same method and trie position, param names ignored (`/u/:id` vs `/u/:userId`) - throws instead of replacing the first.

HTTP method decorators: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head`, `@Options` - all take `(path?, options?)` or `(options)`, where `options` holds the route's request schemas `{ body, query, params }` (see Validation below). GET/HEAD/OPTIONS options have no `body` key (`RouteOptionsWithoutBody`); POST/PUT/PATCH/DELETE take `RouteOptions`.

`@Status(code)` sets default HTTP status for successful responses.

**Subclass controllers.** A subclass serves its parent's routes. Route decorators on an overriding method replace that handler's inherited `ROUTES` entries and `body`/`query`/`params` schemas, decided at decoration time (`dropInherited()` in `decorators/http.ts`, the parent's metadata untouched); an override without them inherits both. Guards and middleware still add up, `@Status`/`@BodyLimit`/`BODY_READERS` inherit until the override sets its own (`@Multipart` on the override also swaps the inherited multipart middleware in its place in the copied `METHOD_MW` list - told apart by a `WeakSet` - so the parent's options stop applying), and `@SkipGuard` on the override drops an inherited guard. Swagger's `API_BODY_SCHEMAS` is inherited and `dropInherited()` leaves it alone, so an override that changes its `body` schema repeats `@ApiBody` or the spec keeps the parent's.

**Global prefix.** `new Miia({ globalPrefix: '/api' })` - the only form - prepends a segment to every route registered through the router: controllers, `app.addRoute()`, `serveStatic()`. `'api'` / `'/api'` / `'/api/'` are equivalent; `*`, `:`, `?`, `#`, whitespace throw `TypeError`. It must be set **before** any route is registered (controller routes resolve when the module graph is processed - first `init()`/`app.get()`/`fetch()` - and `addRoute()` routes on the call, never at `listen()`) - a later assignment throws. There is deliberately no `Miia.setGlobalPrefix()` method: the constructor has no ordering to get wrong, and the name would collide with Nest's, which is read at listen instead. (`TestApp` does have `setGlobalPrefix()` - the builder records it and `compile()` passes it to the `Miia` constructor.) The ordering check lives in the `Router.globalPrefix` setter, so every path into it is guarded. Applied in `Router.add()` only, so it never reaches `RESOLVED_PREFIX` and stays out of the OpenAPI spec (unlike `@Module({ prefix })`). Opt out per route with `app.addRoute(..., { skipGlobalPrefix: true })` - the fourth argument is an `AddRouteOptions` object (`middlewares`, `bodyLimit`, `skipGlobalGuards`, `skipGlobalPrefix`), the same options `router.add()` takes for routes registered from a provider's `onReady` the way `@miiajs/swagger` does. `serveStatic()` forwards `skipGlobalPrefix` from its own options. Start-up route logs (`Mapped {/path, METHOD} route`, context `Router`) are written by `Router.add()` once the route is accepted, so they list every route at the path it is served at, prefix included: controllers, `addRoute()`, `serveStatic()` and routes added from `onReady`.

### Middleware: Koa onion model

Single `compose()` function wraps middleware array into a pipeline. Two registration points with different scopes:

- **`app.use(...middlewares)` - pre-route global.** Composed once by `compilePipelines()`, which runs only in `init()` (`use()` after `init()` throws), into `compiledGlobalPipeline` and wraps the entire dispatch, including `router.match`. Runs on **every** request, including 404s - errors (like `NotFoundException`) bubble up through the onion, so middleware can observe them via `try { await next() } catch`. This is how CORS, request loggers, and request-id middleware see unmatched routes.
- **`@Use(...middlewares)` - route-bound.** Applies at class (all routes) or method level. Composed into per-route pipelines that run inside the inner `next()` of the global pipeline.

```ts
type Middleware = (ctx: RequestContext, next: () => Promise<void>) => void | Promise<void>
```

Semantics to remember:
- **`ctx.params` is `{}` inside global middleware before `await next()`** (router hasn't matched yet). After `await next()`, it's populated with matched route params (or stays `{}` on 404).
- **Early termination:** global middleware that does not call `next()` short-circuits dispatch - `router.match` never runs, handler never runs. The response is built from `ctx.res` (same semantics as a handler returning `null`).
- **Error observation:** a middleware wrapping `await next()` in `try/catch` sees `NotFoundException` from router, errors from per-route middleware, and errors from the handler - uniform Koa contract.

### Guards: @UseGuard and CanActivate

`@UseGuard(...guards)` applies at class or method level. `app.useGuard(...guards)` registers app-level global guards. Guards implement `CanActivate`:

```ts
interface CanActivate {
  canActivate(ctx: RequestContext): boolean | Promise<boolean>
}
```

Returns `false` → `ForbiddenException` (403). Execution order: class guards → class middleware → method guards → method middleware → route schema validation → handler. Global guards (from `app.useGuard()`) run first of all, but only on **matched** routes - they are not invoked on 404s.

`@SkipGuard(GuardClass)` excludes a guard from a route's pipeline at compile time. It works for **class/method-level guards AND global guards** - if the user registers `app.useGuard(AuthGuard(JwtAuth))` and a method has `@SkipGuard(AuthGuard)`, that method bypasses the global guard entirely. Factory-built guards (e.g. `AuthGuard(JwtAuth)`) carry the `GUARD_FACTORY` symbol, so skipping by the factory skips every guard it built.

`GUARD_RESPONSES` (symbol from core) is a **static** on the guard class listing the statuses it rejects with: `static [GUARD_RESPONSES] = [401]`, or `[{ status: 403, description: '...' }]` (type `GuardResponseDeclaration`). Documentation-only - `@miiajs/swagger` reads it to emit guard responses per route; zero runtime effect. A guard without the marker contributes nothing to the spec. `AuthGuard` (`@miiajs/auth`) declares 401, rate-limit guards declare 429. `Router.globalGuards` exposes the guard classes captured at `compileAll()` so the spec builder sees `app.useGuard()` registrations too.

### Rate limiting: @miiajs/rate-limit

Fixed-window rate limiting on one core (`RateLimiter` with Upstash-style `limit(key) => { success, limit, remaining, resetMs }`). Two layers with distinct roles:

- **Guard flow (primary):** `RateLimitModule.configure({ limit, window, store?, keyGenerator?, headers? }, { global: true })` + `app.useGuard(RateLimitGuard)` for app-wide enforcement, `@RateLimit(policy)` for per-route/per-controller policies, `@SkipRateLimit()` to disable on a route. This is the recommended path for business rate policies.
- **Perimeter middleware:** `app.use(rateLimit({ limit, window }))` - standalone (no DI required) and the only form that covers 404s/unmatched scans (global guards never run on unmatched routes). Do NOT combine a global `rateLimit()` middleware with the decorators - the two layers know nothing about each other (`@SkipRateLimit` and replacement do not apply to middleware).

`window` accepts ms or `'500ms'`/`'10s'`/`'1m'`/`'1h'`/`'1d'` strings. On exceed both layers throw `TooManyRequestsException` (429) with `details.retryAfter`. Headers default to draft-6 `RateLimit-*` + `Retry-After`; `'legacy'` emits `X-RateLimit-*`; `false` disables (and restores the response fast path - any set header opts out of inline-JSON/LightResponse optimizations). Default key is `ctx.ip ?? 'unknown'` - behind a proxy set `trustProxy` on the app. Storage is pluggable via `RateLimitStore` (`increment()` returns hit count AND block decision atomically - contract is ready for a Redis Lua store); `MemoryStore` ships in the box, no timers, lazy expiry.

Semantics to remember:
- **Replacement, like `@BodyLimit`:** the most specific policy wins. `@RateLimit` on a method replaces the class-level policy AND the global guard for that route; on a class it replaces the global guard for all routes of the controller. A decorated route does not consume the global quota. Buckets: method = per route, class = shared by the controller's routes, global = one bucket for all matched routes; explicit `prefix` shares a bucket deliberately.
- **Skip beats specificity (unlike the `@BodyLimit` analogy):** `@SkipRateLimit()` disables rate limiting entirely on its scope - including a `@RateLimit` on the same method, and a class-level skip disables method-level `@RateLimit`s too. Use `@SkipRateLimit()`, not `@SkipGuard(RateLimitGuard)` - the latter only catches the bare global guard and explicit factory guards, not decorator-applied policies (their `GUARD_FACTORY` markers are internal scope sentinels).
- **Stacking is middleware-only:** an explicit `@UseGuard(RateLimitGuard(policy))` still stacks with the global guard, but any `@RateLimit`/`@SkipRateLimit` on that route disables it; for guaranteed stacked limits use the `rateLimit()` middleware via `@Use`.
- **Eager construction:** `app.useGuard(RateLimitGuard)` constructs the bare guard at startup, before any `onInit()`, even if every route replaces it - the guard is checked from the root, so without `RateLimitModule.configure(opts, { global: true })` (options visible from the root) the app fails at startup by design.
- **`blockDuration`:** once exceeded, the key is blocked for that duration (the triggering request already gets `Retry-After` = blockDuration); after the block expires the client gets a fresh window. Optional geometric backoff (`blockBackoff` > 1 with a required `maxBlockDuration` ceiling, and `strikeReset` grace measured from the end of the block) grows the ban per repeat offence and resets strikes after a quiet period.

### Validation: route schemas `{ body, query, params }`

Schemas go into the HTTP method decorator: `@Post('/', { body: CreateUser, query: Paging })`, `@Get({ query: Paging })` (no path = controller root), `@Patch(':id', { params, body })`. Any `ZodLike` (Zod or anything with `safeParse()`). The decorator writes them into `BODY_SCHEMAS` / `QUERY_SCHEMAS` / `PARAMS_SCHEMAS`, and `RouterExplorer` builds one validation middleware per route from them. Transforms replace `ctx.params` / `ctx.query` / the `ctx.json()` cache, so `await ctx.json<T>()` returns validated data. Failure -> `UnprocessableException` (422) with the issues in `details`: `'Params validation failed'`, `'Query validation failed'`, `'Body validation failed'`.

Semantics to remember:
- **Runs last, fixed order:** after global guards, class guards, class middleware, method guards and method middleware - right before the handler - and always params -> query -> body. A guard rejection (401/403) never reaches the schemas. A method-level `@Use` sees raw values before `await next()` and validated ones after.
- **No schemas, no middleware:** a route without schemas gets no validation middleware and keeps its fast path.
- **Decoration-time `TypeError`:** a `body` on GET/HEAD/OPTIONS (the types already forbid it; plain JS gets the throw); a GET/HEAD/OPTIONS route and a `body` schema on the same handler, in either decorator order; two different schemas for one key on one handler. Schemas belong to the handler, so stacked routes (`@Get('a') @Get('b')`) share them - a route without options shares them too, and the same schema twice is fine.
- **Body readers:** `BODY_READERS` (`Map<handlerName, BodyReader>`, exported with the `BodyReader` type) decides how `body` is read. `BodyReader = { contentType, read(ctx), commit(ctx, data) }`: `read` returns the value the schema validates, `commit` stores the validated data where the handler's own accessor finds it, `contentType` is what the spec shows. Without an entry the built-in JSON reader is used (`ctx.json()` in, `ctx._setBody()` out): malformed JSON -> 400 before the schema runs, an empty body -> `undefined` -> 422; `HttpException` and the adapters' `PayloadTooLargeError` pass through (413), and only an unexpected read failure becomes `null` -> 422. `@Multipart` registers a form reader.
- **The slots are live:** whatever writes `BODY_SCHEMAS` / `QUERY_SCHEMAS` / `PARAMS_SCHEMAS` turns on runtime validation, a custom decorator included. That is why `@ApiBody` writes its own swagger key instead.

### Request body access: ctx.json(), ctx.text()

```ts
async create(ctx: RequestContext) {
  const data = await ctx.json<CreateUserDto>()
  return this.userService.create(data)
}
```

- `ctx.json<T>()` - parses the request body as JSON and caches the result per request (Promise cache). Second call returns the same object identity.
- `ctx.text()` - parses the request body as text, cached per request.

**One read, two views.** `ctx.json()` reads through `ctx.text()` and parses the cached text, so the two share one read of the body and combine in any order on every runtime. An empty body (or none, e.g. a GET) makes `ctx.json()` resolve `undefined`; a non-empty body that does not parse rejects with `BadRequestException` (400) on every route, with or without a schema. After a `body` schema runs, `ctx.json()` returns the validated data while `ctx.text()` still returns the raw text.

**Escape hatch.** For streaming, multipart, or binary payloads, use `ctx.req.body` (ReadableStream), `ctx.req.formData()`, or `ctx.req.arrayBuffer()` directly. These are available **only before** the first `ctx.json()` / `ctx.text()` call - once the body is consumed through the helpers, the escape hatch will throw.

### Multipart uploads: @miiajs/multipart

`@Multipart(options?)` is the method decorator that opens a `multipart/form-data` route. It attaches two members to the context, both typed by the exported `MultipartContext` (the package does not augment `RequestContext` globally - same call as `ctx.user` in auth, annotate the handler parameter by hand):

- **`ctx.parts` - streaming.** Async iterator of `FilePart | FieldPart`; a file part carries `stream` (`ReadableStream`) and `bytes()`. Backpressure is real - the source is read only when every queue the consumer can still drain is empty (reaches the socket on Bun/Deno/node-server/uws-server).
- **`ctx.form<T>()` - buffered.** One pass over the whole body into `{ files: Record<string, File[]>, fields: Record<string, string> }` (repeated fields: last wins), cached per request like `ctx.json()`. A `body` schema on the route decorator (`@Post('/x', { body })`) validates a **flat** object - text fields (strings, last wins) next to files under their own names, a `File`, or a `File[]` only when the name repeats (a schema that always expects `z.array(...)` rejects a one-file upload) - the way OpenAPI describes a multipart body; the form `BodyReader` that `@Multipart` registers is what makes this work. Success replaces the cache, so `ctx.form<T>()` returns the schema's data and `ctx.parts` throws `TypeError`. Failure -> `UnprocessableException` (422) `'Body validation failed'`. Without `@Multipart` a `body` schema reads JSON, so a form request gets 422.

The package writes nothing to disk and has no `node:*` import anywhere - the contract is standard web types (`ReadableStream`, `File`), so where the bytes go is the application's call; the `uploads` module in `examples/full-app` shows one local-disk path.

Parsing runs on `multipasta` (a `dependency`, not a peer) behind our own Web Streams bridge; limit errors map to `PayloadTooLargeException` (413), malformed or non-`multipart/form-data` bodies to `BadRequestException` (400).

Semantics to remember:
- **Body budget resolution:** explicit `bodyLimit` -> derived `maxFileSize × maxFiles + fieldsBudget` when both are finite -> `@BodyLimit` on the method or the controller -> nothing of its own, in which case the route's own body limit (its `@BodyLimit`, else the app default) is what a chunked body is counted against on node-server, and the adapter ceiling everywhere else. The winner is written into `BODY_LIMITS`, so `@Multipart` and `@BodyLimit` on the same method fight over one slot (last decorator applied wins) - do not combine them. Whatever the route ends up with also raises `Router.adapterBodyCeiling` for the **whole app** (`max(default, all route limits)`), so a generous upload route quietly lifts the 1MB default for every other route.
- **Decorator order does not matter:** route validation always runs after method middleware, so it runs inside the `@Multipart` middleware whichever of `@Post`/`@Multipart` is on top. `@Multipart` reads its options from `context.metadata` at request time, not from the closure, so a `@BodyLimit` applied after it can still become the budget.
- **One part at a time:** advancing the iterator abandons the previous part and **errors** its stream rather than closing it - a half-read upload can never look complete. Collecting parts into an array and reading them later does not work.
- **The body is consumed once:** `@Multipart` is incompatible with `ctx.json()` / `ctx.text()` on the same route (a route `body` schema reads through the form reader, not JSON). A non-multipart request is rejected with 400 by `@Multipart` before the handler runs - and before any route schema, which sits after it - whether or not it touches `ctx.parts`. `ctx.parts` and `ctx.form()` exclude each other too, and the package enforces it - `ctx.parts` is handed out wrapped, so whichever runs second throws instead of returning an empty form or iterating zero times.
- **Spec:** the content type (`multipart/form-data`) comes from the form reader, the schema from the route's `body`, and the 422 from that schema. `z.instanceof(File)` converts to `{}`, so file fields are documented with `@ApiBody` (`format: 'binary'`), which has its own key and overrides the route schema in the spec in any decorator order.
- **`allowedTypes`** gates **file** parts by media type - exact (`image/png`) or subtype wildcard (`image/*`), list and header both trimmed and lower-cased. Checked at the head of a part, before its body is read, so an oversized upload is refused on its header; failure is `UnsupportedMediaTypeException` (415) with `details: { mediaType, allowed }`. Fields are never checked - a part with no `Content-Type` is `text/plain` per RFC 7578 and would fail an image list; a file with none is compared as `application/octet-stream`. An empty list or an entry that is not `type/subtype` (`png`, `image/`, ` / `) throws `TypeError` when the class is defined (no files at all is `maxFiles: 0`). The header is client-supplied, so this is early refusal, not a content check.

### Connection info: ctx.conn, ctx.ip, trustProxy

`ctx.conn: ConnInfo` (`{ remoteAddress?, remotePort?, family? }`) is the transport-level connection info - lazy, cached per request, always the honest socket address. Sources: adapter-injected `_conn` on the Request (node-server/uws-server/TestApp) or the runtime's second fetch argument (Bun `server.requestIP()`, Deno `info.remoteAddr`); empty object when unknown (e.g. serverless). `ctx.ip` is the client IP: with `new Miia({ trustProxy })` it resolves from trusted proxy headers, otherwise equals `conn.remoteAddress`. `trustProxy` forms: `true` = leftmost `x-forwarded-for` (spoofable if the proxy appends rather than overwrites - prefer your edge's vendor header), `'cf-connecting-ip'` = single trusted header, array = priority order. `TestApp.request(method, path, { ip })` fakes the IP in tests. uws-server gives `remoteAddress` as uWS's text, IPv6 expanded (`0000:...:0001`, not `::1`); in optimized mode a lazy `_conn` getter on the request proxy builds it.

### Response: ResponseBuilder

Fluent API available on `ctx.res`:
```ts
ctx.res.status(201).header('X-Custom', 'value').json({ created: true })
```

Methods: `status()`, `header()`, `json()`, `text()`, `html()`, `redirect()`, `stream()`, `build()`.

Handlers can also return plain objects (auto-serialized to JSON), `Response` instances, or `null`/`undefined` (empty body, status from `ctx.res`: 200 unless `@Status()` or `ctx.res.status()` changed it; use `@Status(204)` for No Content).

### Cookies: ctx.cookies + ResponseBuilder.cookie()

Read incoming cookies and write response cookies. `ctx.cookies` is a lazy jar; writes delegate to `ResponseBuilder`. `serializeCookie`/`parseCookieHeader`/`CookieJar`/`CookieOptions` are public.

```ts
ctx.res.cookie(name, value, options?)          // append Set-Cookie
ctx.res.deleteCookie(name, { path?, domain? }) // epoch Expires + Max-Age=0
ctx.cookies.get(name) / getAll() / has(name)   // read incoming Cookie header
ctx.cookies.set(name, value, options?) / delete(name, opts?) // delegate to res
```

Semantics to remember:
- **Defaults:** `path: '/'` defaults at `ResponseBuilder.cookie()` (NOT in `serializeCookie`); `maxAge` is in **seconds** (unlike Express ms).
- **Writes:** `cookie()`/`set()` set `_modified` and `append` (multiple `Set-Cookie` headers survive the fast path, even on error responses).
- **Secure/SameSite:** `sameSite: 'none'` auto-enables `Secure`; `secure: false` + `'none'` throws `TypeError`, as does `partitioned` without a resolved `Secure`.
- **Raw Response:** returning a native `Response` bypasses `ctx.res` - set cookies on it manually.
- **Reads:** a write is NOT visible in the same request's `get()` (jar reflects only the incoming header). Parsing: auto-`decodeURIComponent` (raw fallback), first-wins on duplicates, null-proto cache for `get()`/`has()`, `getAll()` returns a plain-object snapshot.
- **Validation:** `TypeError` on invalid RFC 6265 name, header-injection chars in `path`/`domain`, non-finite `maxAge`, invalid `expires`. `priority` is non-standard (Chromium); `partitioned` is CHIPS.

### Exceptions: HttpException hierarchy

Base `HttpException(statusCode, message, details?)` with `.toJSON()`. Derived classes:
- `BadRequestException` (400), `UnauthorizedException` (401), `ForbiddenException` (403)
- `NotFoundException` (404), `ConflictException` (409), `PayloadTooLargeException` (413)
- `UnsupportedMediaTypeException` (415), `UnprocessableException` (422), `TooManyRequestsException` (429)
- `InternalServerException` (500)

Unhandled errors in handlers are caught, logged, and returned as 500. An `Error` whose `name` is `'PayloadTooLargeError'` (thrown by node-server/uws-server body streams, which do not depend on core) is mapped to `PayloadTooLargeException` (413).

### CORS: built-in middleware

`cors(options?)` middleware in `@miiajs/core`. Options: `origin` (string/array/function), `methods`, `allowedHeaders`, `exposedHeaders`, `credentials`, `maxAge`. A preflight is an `OPTIONS` with both `Origin` and `Access-Control-Request-Method` (Fetch spec) and is answered with 204 before the router; any other `OPTIONS` goes on to its route (`@Options`, else 404) with the simple-request CORS headers. Any `origin` but `'*'` adds `Origin` to `Vary` on every response - refused or missing `Origin` included, so a CDN never hands a refusal to an allowed origin - appended to a `Vary` already set, never over it.

### Auth: AuthProvider + AuthGuard

`@miiajs/auth` ships primitives only. An `AuthProvider` is a plain `@Injectable()` class with `authenticate(ctx)` that returns the authenticated subject or throws an `HttpException`. `AuthGuard(Provider, ...more)` resolves the provider classes from the container when the guard is constructed and tries them in order: the first that resolves wins and its result goes to `ctx.user`. An `HttpException` moves on to the next provider (OR semantics), any other error is rethrown as a bug, and when all fail the last error is rethrown. For AND semantics stack guards: `@UseGuard(AuthGuard(JwtAuth), Roles('admin'))`. The guard declares `[GUARD_RESPONSES] = [401]` and is named `AuthGuard(JwtAuth, ...)` after its providers. No module declares it, so the providers must be visible from the module of every controller that uses it - usually a `global: true` `AuthModule` with `imports: [UsersModule]` and `exports: [JwtAuth]`. `ctx.user` is not on `RequestContext` - apps add it with a `declare module '@miiajs/core'` augmentation.

Also exported: token extractors `fromHeader(header = 'authorization', scheme = 'Bearer')`, `fromCookie(name)`, `fromQuery(param)` (each returns a `TokenExtractor`, `(ctx) => string | null`) and `timingSafeEqual(a, b)`.

**JWT** is a separate package, `@miiajs/jwt`: `JwtModule.configure()` with `secret` or `privateKey`/`publicKey`, `JwtService.sign()` / `verify()` via `jose`. A JWT provider is a few lines of app code (`fromHeader()` + `verify()`), not something the package ships.

**Local** (username/password) and **OAuth2** are recipes in the docs (`2.auth/3.local.md`, `2.auth/4.oauth2.md`), not packages - by design, auth flows stay app code.

### Config: @miiajs/config

`ConfigModule.configure(optionsOrFactory, { global? })` (options `{ schema?, env? }`) exports `ConfigService` and `CONFIG_SOURCE`. Its private tokens (`src/tokens.ts`, not exported from the index): `CONFIG_OPTIONS` - the options, resolved once (the factory runs once); `CONFIG_SOURCE` - a frozen `{ env }` holder (`env` or `process.env`), so `process.env` itself never becomes an instance the container probes for hooks; `CONFIG_VALUES` - a snapshot taken at startup: without a schema a frozen copy of `env` (top level, the values are strings), with a schema `deepFrozenCopy(parseEnv(schema, env))`, which copies and freezes plain objects (prototype `Object.prototype` or `null`) and arrays, copies cycles and shared parts once through a `WeakMap`, returns everything else (`Map`, `Set`, `Date`, class instances) as is and never freezes its input. A later change to `process.env` or to the passed `env` is not seen; writing to a frozen value throws `TypeError`. `ConfigService` keeps the values in `#config`. The types are not `readonly` on purpose: `get()` returns `T[K]`, since `readonly string[]` would not pass where `string[]` is expected (`cors({ origin: config.get('CORS_ORIGIN') })`). A config without a schema enumerates the whole env, so on Deno it needs `--allow-env` without a list.

**Feature configs.** `defineConfig(name, schema)` returns a frozen `ConfigToken<T>` (`Token<Readonly<T>>` plus `configName` and `schema`, `T` inferred from the schema's `safeParse()` output), named `Config(<name>)` with the hint `ConfigModule.register() with defineConfig('<name>')`; not memoized, identity is the export site. `ConfigModule.register(config)` returns an anonymous module named `ConfigModule.register(<name>)` (errors, start-up log) that exports the token and declares it with `provider(config, factory, { shared: 'config' })`, so every module that registers it shares one instance and the schema runs once. The factory reads `injectOptional(CONFIG_SOURCE)` - the same `env` as the root `configure()` (its `env` or `process.env`), `process.env` when the app has no `configure()` - and returns `deepFrozenCopy(parseEnv(schema, env, name))`. That is why `configure()` exports `CONFIG_SOURCE`: the factory reaches it through its host (a configured module also sees what its host sees) or a global root config. A root config that is registered but not visible from the module importing `register()` (not global, not imported there) is a boundary violation, checked from every module that registers the config, so the order of `imports` does not matter. The validation error has no host module - a package factory cannot know who imported `register()`: `[Miia] Config validation failed for 'payments':` plus the issues. `TestApp.override(token, value)` replaces it like any provider.

### Database: configure/register pattern

All DB packages (`drizzle`, `papr`, `mongoose`) follow the same pattern:
- `Module.configure(optionsOrFactory, { name?, global? })` - connection setup with retry logic; returns `{ module: XModule, name, global, exports }`. Exports the db / connection token; papr/mongoose also export their internal service and registry tokens, which the `register()` model factories reach through the module that imports the `register()` result
- `Module.register(models, { name? })` - register models in feature modules (papr/mongoose only; drizzle is schema-first, all tables go into `configure({ schema })`); exports the models, and its anonymous module is named `PaprModule.register([users])` / `MongooseModule.register([User])` in messages. Each model is a shared provider keyed by connection (`the default connection`, `connection 'analytics'` - a connection named `'default'` is not the unnamed one), so several modules may register the same model and get one instance (each of them must see `PaprModule` / `MongooseModule` itself); one token on two connections throws at startup (`... is shared by ... (the default connection) and ... (connection 'analytics')`)
- Models / databases become DI tokens via `defineModel(...)` (papr/mongoose) or `drizzleDb<TDb>(name?)` (drizzle). Use standard `inject(User)` / `inject(paprDb())` / `inject(mongooseConnection())` / `inject(db)`. All of them are `Token` objects (`createToken`), not classes: `drizzleDb()` / `paprDb()` / `mongooseConnection()` are memoized by connection name (`''` is the default), `defineModel` returns a fresh frozen token per call carrying `collectionName` / `modelName` and `schema`. The internal service and registry tokens are private (`src/tokens.ts`, not exported from the index)
- Optional `{ name }` for multi-connection support
- Drizzle `dialect: 'sqlite'` runs on `bun:sqlite` on Bun and `better-sqlite3` elsewhere; `connection.driver` overrides, and Deno is refused unless the driver is explicit (`better-sqlite3` segfaults there)
- Lifecycle: `onInit()` connects with retry, `onDestroy()` closes connection; the db / connection token declares `deps` on the service, so a provider injecting it gets its hooks inside that window
- The injected db / connection / model is a lazy proxy built on core's `createLazyProxy()`: it resolves on first use, and the container probing lifecycle hooks does not resolve it

### Swagger: OpenAPI 3.1 + Swagger UI

`SwaggerModule.configure(options)` returns a configured module - add it to your root `@Module({ imports: [...] })`. Internally, `SwaggerService` injects `DiscoveryService` + `Router` and registers the `/docs/json` + `/docs/*` endpoints from its `onReady()` hook; it iterates controllers through `DiscoveryService.getClassesWithMeta(RESOLVED_PREFIX)` without touching `ModuleLoader` internals.

Decorators: `@ApiTag`, `@ApiOperation`, `@ApiResponse`, `@ApiParam`, `@ApiQuery`, `@ApiSecurity`, `@ApiHeader`, `@ApiExclude`.

`SpecBuilder` auto-infers path params from route patterns, query params from the route's `query` schema, and the request body from `@ApiBody` (doc-only, own `API_BODY_SCHEMAS` key, wins in any decorator order) or else the route's `body` schema. Body content type: `@ApiBody`'s `contentType` option -> the route's `BODY_READERS` entry (`multipart/form-data` under `@Multipart`) -> `application/json`.

Response rules:
- **422** is added only when the route declares a real `body`/`query`/`params` schema. `@ApiBody` alone adds none - it documents, it does not validate - so a route whose own code answers 422 declares `@ApiResponse(422)`.
- **Guard responses** come from `GUARD_RESPONSES` on the guard class - global + class + method guards, minus anything `@SkipGuard`/`@SkipRateLimit` removed. No blanket 403; an unmarked guard adds nothing. An explicit `@ApiResponse` of the same status wins.
- **Default success response** (`@Status(code)`, else 200) is suppressed by any explicit `@ApiResponse` with a 2xx or 3xx status. Description comes from the status table; `content` is attached only for 2xx except 204/205, so redirects and 204 have no phantom JSON body.

Schema conversion prefers the schema's own `toJSONSchema()` (zod 4) / `toJsonSchema()` export, duck-typed - no zod dependency; zod 3 and raw JSON Schema fall back to the manual walker. Bodies/params use `io: 'input'`, responses `io: 'output'`; `format` is merged from the output side so `z.string().trim().pipe(z.email())` keeps `format: email`. `$defs`, `.meta({ id })` schemas, and recursive schemas are lifted into `components.schemas` with refs rewritten (name clashes get `_Input`/`_Output`, then `_2`).

Every global guard is in the spec - it is serialized once in `onReady`, and `app.useGuard()` after `app.init()` throws. Not in the spec: the perimeter `rateLimit()` middleware (middleware has no readable metadata), and the app-level `globalPrefix` (applied in `Router.add()`, never in `RESOLVED_PREFIX`) - paths stay clean, so the base URL including the prefix must be written into `servers` by hand or Swagger UI "Try it out" 404s.

Spec served at `{path}` (default `/docs/json`), UI at `{uiPath}/` (default `/docs/`). Only `swagger-initializer.js` is overridden.

Swagger routes register themselves with `{ skipGlobalGuards: true, skipGlobalPrefix: true }` so the UI stays reachable even when the app has a global `AuthGuard` via `app.useGuard()`, and stays at its configured `path`/`uiPath` under a `globalPrefix`. Global middleware from `app.use()` (CORS, logging, request-id) still applies to swagger endpoints - only guards are opted out.

### Server: app.listen() with runtime auto-detection

`app.listen(port, hostname?, adapter?)` initializes DI, compiles routes, and starts the server. Auto-detects `Bun.serve()` / `Deno.serve()`; for Node.js/uWebSockets pass adapter: `app.listen(3000, serve)`. Deno closes a keep-alive connection when the response goes out before the request body has fully arrived, and does not say so - a client's or proxy's pool sends its next request into the closed socket; known, not worked around. Deno builds `req.url` from the `Host` header without checking it (`Host: x/admin` turns `GET /public` into `/admin/public`), so a Deno app belongs behind a proxy that checks or rewrites `Host`. `destroy()` closes the server, then runs `onShutdown()` and `onDestroy()` on every singleton in reverse dependency order; a failing hook does not stop the rest. uws-server's `close()` closes the listen socket, waits for the requests in flight (counted per request; an aborted one drops out; no timeout, so an endless stream holds it) until their responses are handed to uWS - a body in memory in one `res.end()`, a streamed one in pieces of at most 64 KB (`STREAM_PIECE`) that wait for a writable event - and then closes every connection left (`app.close()`), which drops what a slow client has not taken of uWS's buffer yet, a large body in memory included (uWS reports no drain after `end()`; counting it would mean `tryEnd()` for every body). uws-server's early 413 (declared Content-Length over the ceiling) is answered synchronously in the request handler with `Connection: close` and nothing else - no `onData`, so uWS discards the body itself, no close by the adapter (the client closes as told, otherwise uWS's idle timeout, ~10 s), not counted in flight; `node:http` writing 64 MB without `Expect` loses it to a reset in a quarter to a half of tries, with or without the header. node-server's `close()` is `server.close()` of `node:http` as it is. Its early 413 (declared Content-Length over the adapter ceiling) keeps the connection and drains the body (`drainIncoming`, 500 ms / 64 MB, then destroy), so a refused upload still draining at `close()` holds it like any busy connection - until `keepAliveTimeout` + 1 s once the body got through and the connection went idle (native `close()`, by choice), or until the destroy; socket behaviour like this is tested on Node (`bun run test:node-server`, `*.node.test.ts`), not under Bun's node:http. For serverless, use `app.fetch` directly with lazy init.

**node-server / uws-server optimized mode** (default):
- Lazy Request proxy (`Object.create`, hot-path getters for method/url)
- Lightweight Headers proxy (linear scan over pairs, no `new Headers()`)
- Body buffering for small POST bodies (Content-Length ≤ `bufferThreshold`, default 100KB): `Promise<Uint8Array>` decoded straight into `text()` (core's `ctx.json()` reads through it; the adapter's own `json()` shortcut serves only direct `ctx.req.json()` calls), bypasses ReadableStream + `new Request()`. Large/chunked bodies fall back to streaming - on uws-server that stream pauses the socket once it queues past `bodyHighWaterMark` (`serve()` option, default 256KB) and resumes as the handler drains. Ending the response there also **errors** an unread request body, so a body read that was started and never awaited (an unawaited `ctx.json()`) rejects instead of resolving.
- LightResponse cache (status/body/headers tuple, no real Response created for simple responses)
- Sync fast path (zero Promises when no middleware)

**Native mode** (`mode: 'native'`) builds a real `Request` per request: the URL from the request target and a `Host` that is `host[:port]` / `[IPv6]:port` (`PLAIN_HOST`; anything else gives `localhost`, an empty one the listen address), so the Host can never move the path the way `Host: x/admin` would. A request `new Request()` refuses is answered by the adapter without reaching the app - `TRACE`/`TRACK`/`CONNECT` (forbidden by fetch, handed to the app by Bun, Deno and optimized mode) get 501, anything else (a method that is not a token) 400.

**Body size limits.** `new Miia({ maxBodySize })` (default 1MB, `false` disables) + per-route `@BodyLimit(bytes)` (method > class > app option). Limits are resolved into the route table at registration time; declared Content-Length is checked in core after route matching -> `PayloadTooLargeException` (413). Chunked bodies carry no length to check, so they are counted as they arrive. After route matching `checkBodyLimit()` narrows the adapter's `_bodyLimit` slot to the **route's** limit (`Math.min`, never widening what the adapter set) - node-server owns that slot and applies it lazily when the body is first materialized, so the route's own limit is what a chunked body is judged against there. Everything without the slot keeps the adapter ceiling, `max(maxBodySize, all @BodyLimit values)`: Bun (`maxRequestBodySize`), Deno (counting stream wrapper in `listen()`, `denoListenFetch()`; GET and HEAD skip it), uws-server (in-stream cap), both adapters in `mode: 'native'`, and anything reached through `app.fetch` including `TestApp`. Adapter streams error with an `Error` named `'PayloadTooLargeError'` since adapters don't depend on core. Bun rejects with a plain `Error`, which core recognises by its message (`Request body exceeded maxRequestBodySize`) and maps to 413 in `ctx.text()`/`ctx.json()` and in the error handler. Enforcement is consumption-time: a handler that never reads a chunked body lets the client upload up to the ceiling regardless.

### Static file serving

`@miiajs/serve-static` exports two functions:
- `serveStatic(app, prefix, root, options?)` - registers wildcard GET route on app
- `createStaticHandler(root, options?)` - returns handler for manual registration

Features: MIME detection (50+ types, customizable), directory traversal protection, `Cache-Control`, index file with trailing slash redirect, file streaming via `node:fs`.

The mount sits under the app's `globalPrefix` like any other route; `skipGlobalPrefix: true` pins it to `prefix` instead - the SPA-at-`/` in front of a prefixed API case. That flag lives on `ServeStaticMountOptions` (what `serveStatic()` takes, extends `ServeStaticOptions`), not on `ServeStaticOptions` itself, which `createStaticHandler()` takes and which owns no mount.

### Testing: TestApp + bun test

`TestApp` from `@miiajs/testing`:
```ts
const app = await TestApp.create(AppModule).override(drizzleDb(), mockDb).compile()
const res = await app.request('GET', '/users')
await app.close()
```

Methods: `provide()`, `override()`, `use()`, `useGuard()`, `setGlobalPrefix()` (the builder form `Miia` deliberately lacks), `compile()`, `request()`, `resolve()`, `close()`. The builder methods only collect; `compile()` builds the `Miia` from all of it (prefix, providers, middleware, guards, modules with the override descriptors, `init()`). A builder call after `compile()` (a second `compile()` included) throws, and so do `request()`/`resolve()`/`close()` before it.

`override()` builds a descriptor (`overrideProvider()` / `overrideModule()` from core) that goes through `register()` next to the modules and replaces one entry while the graph loads - not a `provide()`-first race. Targets: a provider a loaded module declares (`providers` or a `configure()`'s providers), a `provide()` token, the built-ins `DiscoveryService` and `Resolver` (an overridden `Router` would reach only DI consumers - the app dispatches through its own), not `REQUEST_CONTEXT` (every request seeds its own - `override(RequestContext)` throws); a configured module with `override(XModule, XModule.configure(test))`, matched by the pair (class, name) - a `ConfiguredModule` of another class (the anonymous module of a papr/mongoose `register()`, or a user module) throws. A token nothing provides throws `[Miia] override(X): no loaded module provides X`; overriding a module the graph does not configure throws too - a feature that imports it bare is tested as `TestApp.create(FeatureModule, X.configure(test))`. Guards and controllers are overridable only when declared in `providers` / `controllers`. Descriptors are allowed only at the top level of `register()`. A plain-object override has no class, so `DiscoveryService` does not see it (an `@On` handler is not subscribed, a controller drops out of the swagger spec); a named subclass without its own decorators (`class FakeHandler extends Handler {}`) keeps it discoverable.

Tests use `bun test` with explicit imports: `import { describe, it, expect } from 'bun:test'`.

### CLI: @miiajs/cli

Commands: `miia new`, `miia add`, `miia generate` (alias `miia g`), `miia dev`, `miia build`, `miia start`, `miia check`. `create-miia` (`packages/create-miia`) is a one-line bin over `run(['new', ...argv])` exported by the CLI (`--version` alone passes through); it sits in the changesets `fixed` group with `@miiajs/*` and depends on `typescript`, because Yarn does not install the CLI's peer.

**Errors:** library code throws `CliError(message, exitCode)`; only `action()` at the command boundary prints it and sets `process.exitCode`. The logger is a consola instance with a fixed level (the default one drops `log`, errors included, under `NODE_ENV=test`).

**Runtime detection** (`resolveRuntime`): `--runtime`; then walking up from cwd, on each level `deno.json`/`deno.jsonc` before lockfiles (`bun.lock`/`bun.lockb` -> Bun, `deno.lock` -> Deno, npm/yarn/pnpm -> Node); then `bun`/`deno` in PATH; then Node. Executables come from `findExecutable`/`findLocalBin` (PATHEXT on win32), not `which`. The package manager comes from lockfiles or `npm_config_user_agent`.

**dev/start:** `dev` runs the runtime's watcher plus `tsc --noEmit --watch --pretty false`; no restart loop (the watchers wait for the next change), a dead `tsc` is a warning, the watcher's exit ends `dev` with its code. Signals go through `createSignalPolicy`: first -> `SIGTERM` to the children, a repeat within 1 s (the `bun run`/`npm run` duplicate) -> ignored, later -> `SIGKILL`; execa runs with `forceKillAfterDelay: false`; on POSIX the dev watcher gets its own process group, killed as a whole (`node --watch` runs the app as a grandchild). Exit code (`childExitCode`): the app's non-zero code, else `128 + n` for a forwarded or fatal signal, else 0. `NODE_ENV` is set only when absent. Node `build` uses `tsconfig.build.json` when present and refuses an effective `noEmit: true`; `start` adds `--enable-source-maps`.

**Templates:** `packages/cli/templates/` ships in the package: `base/`, `runtimes/{bun,node,deno}/`, `addons/<id>/`, `generate/<schematic>/`. A template is `files/` + optional `files-bun/` / `files-node/` (Node and Deno share the `node` flavor) + optional `manifest.json` / `manifest-<flavor>.json` (`dependencies`, `devDependencies`, `scripts`; full `^X.Y.Z`; `@miiajs/*` as `workspace:*`, written as `^<CLI version>`). Dotfiles are stored as `_gitignore`, `_env.example`, `_biome.json` (npm drops dotfiles; a nested `biome.json` is a second Biome root). Placeholders: `{{name}}`, `{{run:dev}}`, `{{exec}}` (README); `__Name__` / `__name__` / `__file__` (schematics, file names included). `templates/package.json` (`miia-cli-templates`: private, no version, not packed) makes the folder a workspace so the IDE resolves the imports; `templates/tsconfig.json` lists the layers in `rootDirs`, and `bun run typecheck` checks the templates with it (`typecheck:templates`), so an API change that breaks a template fails there before `cli:e2e`. That workspace also links optional peers such as `mysql2` into other packages, so an optional-peer import takes `@ts-ignore`, not `@ts-expect-error`.

**Codemods:** every change goes through `ProjectTree` (in memory; `commit()` writes, `--dry-run` prints `summary()`). `codemod/source.ts` (`addImport`, `addToModuleArray`, `addSchemaKey`, `insertStatement`, `hasModuleEntry`) finds positions with the TypeScript compiler API and inserts text, keeping EOL, indent and comments; a shape it cannot handle returns `'unsupported'` and becomes a warning, never a guess. `typescript` is a peer (`^6.0.0`) loaded lazily by `loadTypeScript()`.

**new / add:** `createProject` = base + runtime layers merged in memory, `.env` as a copy of `.env.example`, then add-ons in `resolveAddons` order. An add-on (`src/addons/`, registry in `src/addons/index.ts`) has `isInstalled(tree, layout)` and `apply(ctx)`; `miia add` = `openProject` (runtime from `--runtime` in `scripts.dev`, files via `detectLayout`) + `addToProject` (installed ones skipped, a second database refused) + install + format. Infrastructure modules are `{ global: true }`; `AuthModule` is global with `exports: [JwtAuth]`.

**Generate:** the schematic table is `generate/schematics.ts`. A resource is always in its own folder, goes into the parent's `imports`, and its module exports its service; `--export` is for services only; guards and middleware are not registered. The parent module is the nearest `*.module.ts` walking up to `src/`, else `src/app/app.module.ts`.

**Generated tests:** `bun:test` with only `describe`/`it`/`test`/`expect` and no hooks (`node:test` on Deno has none); `toNodeTestRunner` rewrites the import to `node:test` + the `expect` package for Node and Deno; each test creates its own `TestApp`. `template-versions.test.ts` checks every manifest against the peer ranges and required peers of the `@miiajs/*` packages and against the templates workspace. The repo's `bun test` skips `packages/cli/templates/**` (`bunfig.toml`, plus a second `--path-ignore-patterns` in the `test` script, since the flag replaces the bunfig list).

**e2e:** `bun run cli:e2e [--only a,b] [--keep]` (`packages/cli/e2e/`): clean build, `bun pm pack` of every package, projects generated outside the repo with `@miiajs/*` pointed at the tarballs (plus `overrides`), install (Deno projects through npm), `check`/`test`/`build`, start with HTTP probes, `miia add` and `miia g` steps, on Bun, Node and Deno. Needs network; it is a release step in `RELEASING.md`.

### Logger

`ConsoleLogger` with colored output, timestamps, PID, context tags, delta times. Configurable via `LoggerConfig`: `level` (ERROR/WARN/LOG/DEBUG), `json` mode, `appName`, `colors` (default on, off when `NO_COLOR` is set and non-empty - read from `Deno.noColor` on Deno, so no `--allow-env`; an explicit `colors` wins). Custom loggers implement `LoggerService` interface. Disable with `new Miia({ logger: false })`.

## Code conventions

- All imports use `.js` extension (ESM requirement with `verbatimModuleSyntax`)
- `sideEffects: false` in all packages
- Barrel files (`index.ts`) in each subdirectory
- `Symbol.metadata` for all decorator metadata (polyfilled via `@miiajs/core`)
- Tests in `packages/*/test/*.test.ts`, import from `bun:test`
- Biome formatting: single quotes, trailing commas, semicolons as needed, 120 char line width
- `workspace:*` for internal package dependencies
- All packages target ES2025, `module: nodenext`

## Development workflow

```sh
bun install                    # install all dependencies
bun run build                  # build all packages (tsc --build)
bun test                       # run all tests
bun run typecheck              # type-check without emitting: packages, their tests (typecheck:tests), examples, CLI templates
bun run format                 # format all files with Biome
bun run format:check           # check formatting without writing
bun run cli:e2e                # generate, install, test and start projects (network, a few minutes)
```

Run example apps:
```sh
cd examples/drizzle-app
bun run dev                    # miia dev --runtime bun
```