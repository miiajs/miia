---
title: 'MiiaJS 0.9: module boundaries, typed tokens and a rebuilt CLI'
description: 'The DI system redesigned: module boundaries checked at startup, typed tokens, request-scoped providers kept on the request, two-phase shutdown, event contracts and a new CLI.'
date: 2026-11-18
author: Ruslan Matiushev
tags: [release]
topics: [modules, typed tokens, request scope, lifecycle, messaging, config, CLI, upgrading from 0.8]
---

MiiaJS is a TypeScript HTTP framework with the modules, providers, controllers and guards NestJS made familiar, built on native TC39 decorators and the Web `Request` / `Response` API. It runs on Bun, Deno and Node.js, and as a plain `fetch` handler on serverless and edge platforms.

0.9 is the largest release so far. The DI system was redesigned: modules have boundaries that startup checks, tokens carry their types, request-scoped providers live on the request, and lifecycle hooks follow dependencies. Around it, messaging got typed event contracts, config got feature configs, and the CLI was rebuilt. The release has breaking changes; [Upgrading from 0.8](#upgrading-from-08) lists the ones most apps will hit, with the fix for each.

To try it:

```bash
bun create miia my-app
```

## Modules with boundaries

Until 0.9 every provider of an app sat in one container, and any of them could inject any other. `imports` described the structure of the app, but nothing enforced it: a forgotten import only showed up when you tried to test a module on its own.

Now a module sees three things: its own providers, what the modules it imports list in `exports`, and the exports of `global` modules. Nothing is global by default, MiiaJS packages included.

```ts
@Module({
  providers: [UsersService, PasswordHasher],
  exports: [UsersService], // PasswordHasher stays private
})
class UsersModule {}

@Module({
  providers: [OrdersService], // OrdersService injects UsersService
})
class OrdersModule {}
```

`OrdersModule` forgot to import `UsersModule`. `init()` builds every singleton, collects every violation it finds, and throws one report before the first `onInit()`, so nothing has connected to a database yet:

```text
[Miia] 1 module boundary violation:

OrdersService (OrdersModule) injects UsersService (UsersModule):
  - add UsersModule to OrdersModule `imports`

Docs: /docs/core-concepts/modules#boundaries
```

The check covers more than `inject()`. Factory providers are checked from their module, and so is everything a guard injects: `AuthGuard(JwtAuth)` on a controller in `UsersModule` needs `JwtAuth` to be visible from `UsersModule`. `inject(Resolver)` returns a resolver bound to the module that injects it, so it is no longer a way around the boundaries.

Infrastructure that almost every module reaches for is configured once, in the root module, with `{ global: true }`:

```ts
@Module({
  imports: [
    ConfigModule.configure({ schema: EnvSchema }, { global: true }),
    DrizzleModule.configure(
      (resolve) => ({
        dialect: 'postgres',
        connection: { url: resolve(ConfigService).getOrThrow('DATABASE_URL') },
      }),
      { global: true },
    ),
    UsersModule,
    OrdersModule,
  ],
})
class AppModule {}
```

A few rules came with it. Module files that import each other use `forwardRef(() => X)` on both sides of the cycle. The same module configured twice throws instead of the first configuration silently winning, and the same provider in two modules names both of them in the error. The module graph is processed once, on the first `init()`, `app.get()` or `fetch()`, so the order of `app.register()` calls no longer matters.

Docs: [Modules → Boundaries](/docs/core-concepts/modules#boundaries).

## Typed tokens

A token is now a class (abstract ones included) or an object from `createToken<T>()`. String tokens are gone. In 0.8 a value that was not a class looked like this:

```ts
@Module({
  providers: [{ token: 'MAILER', factory: () => new SmtpMailer() }],
})
class MailModule {}

@Injectable()
class NotificationService {
  private mailer = inject<Mailer>('MAILER') // the type is whatever you write here
}
```

In 0.9:

```ts
import { createToken, inject, Injectable, Module, provider } from '@miiajs/core'

export const MAILER = createToken<Mailer>('Mailer', { hint: 'MailModule' })

@Module({
  providers: [provider(MAILER, () => new SmtpMailer())],
  exports: [MAILER],
})
class MailModule {}

@Injectable()
class NotificationService {
  private mailer = inject(MAILER) // Mailer
}
```

The type flows from the token wherever it is resolved: `inject()`, `injectOptional()`, `app.get()`, `ctx.resolve()`, `Resolver` and `TestApp.override()`. `provider()` checks the factory against it, so `provider(MAILER, () => 42)` does not compile. The object form from 0.8 still works with a token object, `{ token: MAILER, factory }`, but nothing checks its factory, so `provider()` is the one to use by default. A token is identified by the object, not by its name, so two packages can no longer collide on a string.

DI errors got the same attention. They name the token instead of printing the source of a class, say who required a missing provider, and carry the token's `hint` about where it comes from:

```text
[Miia] No provider found for token: Mailer, required by NotificationService (NotificationsModule)
  - Mailer is provided by MailModule; import that module where Mailer is used
```

Docs: [Providers → Typed tokens](/docs/core-concepts/providers#typed-tokens).

## Request-scoped providers live on the request

A request-scoped instance now lives on the request context. The first `ctx.resolve()` in a request creates it, later calls in the same request return it, and concurrent requests never share one. In 0.8 the instances sat on the container, and two requests in flight could end up with the same one.

```ts
@Injectable({ scope: 'request' })
class RequestLogger {
  private ctx = inject(REQUEST_CONTEXT)
  readonly requestId = this.ctx.req.headers.get('x-request-id') ?? crypto.randomUUID()
}

@Controller('/orders')
class OrderController {
  @Get('/')
  list(ctx: RequestContext) {
    return { requestId: ctx.resolve(RequestLogger).requestId }
  }
}
```

`REQUEST_CONTEXT` is the context itself, as a request-scoped token. When the pipeline of a request has finished and its response is built, every instance the request created gets `onDestroy()`, newest first. The hooks do not hold the response back.

```ts
@Injectable({ scope: 'request' })
class RequestMetrics {
  private metrics = inject(MetricsService)
  private started = performance.now()

  onDestroy() {
    this.metrics.record('request.duration', performance.now() - this.started)
  }
}
```

An instance exists from the first `ctx.resolve()`, so resolve `RequestMetrics` in a global middleware to time the whole request.

Controllers and guards stay singletons. A singleton that injects a request-scoped provider would keep the instance of whichever request built it, so it fails at startup:

```ts
@Injectable() // a singleton
class AuditService {
  private logger = inject(RequestLogger) // fails at startup
}
```

```text
[Miia] AuditService (singleton) injects request-scoped RequestLogger - resolve it with ctx.resolve() in the handler, or make AuditService request-scoped
```

Here request scope differs from NestJS, where a request-scoped dependency makes the classes that inject it request-scoped too, controllers included. In MiiaJS the request scope stays where you declared it.

Docs: [Providers → Request scope](/docs/core-concepts/providers#request-scope).

## Lifecycle hooks follow dependencies

`onInit()` and `onReady()` run in dependency order: a provider's hooks run after the hooks of the singletons it injects. A factory provider that reaches a dependency lazily, after construction, lists it in `deps`.

Shutdown has two phases. `app.destroy()` closes the server, waits for the `onDestroy()` of requests that have finished, runs `onShutdown()` on every singleton (stop taking new work, wait for the work in flight), and only then `onDestroy()` on every singleton (release resources). Both phases run in reverse dependency order, so a provider draining work can still use the connection it injects:

```ts
@Injectable()
class DbConnection {
  async onDestroy() {
    await this.disconnect()
  }
}

@Injectable()
class ReportWorker {
  private db = inject(DbConnection)

  async onShutdown() {
    this.stopPolling()
    await this.currentJob // may still query this.db
  }
}
```

`@miiajs/messaging` uses this: message handlers drain in `onShutdown()`, so the database they write to closes after they finish, wherever its module sits. A failing hook no longer stops the rest. `destroy()` runs every step, logs each failure with its source, and throws afterwards.

Docs: [App lifecycle → Shutdown phase](/docs/core-concepts/app-lifecycle#shutdown-phase).

## Event contracts in messaging

In 0.8 a topic was a string, and the payload type was a promise the handler made:

```ts
@On('user.created')
async sendWelcome(user: { id: string; email: string }) {}
```

In 0.9 an event is a contract that both sides share. `defineEvent(topic, schema?)` returns a frozen `{ topic, schema }`, and `publish()` and `@On()` take only contracts:

```ts
import { inject, Injectable } from '@miiajs/core'
import { defineEvent, type EventPayload, MessageBus, On } from '@miiajs/messaging'
import { z } from 'zod'

export const OrderPlaced = defineEvent(
  'order.placed',
  z.object({
    orderId: z.string(),
    total: z.number().positive(),
    placedAt: z.coerce.date(),
  }),
)
export type OrderPlaced = EventPayload<typeof OrderPlaced>

@Injectable()
class Orders {
  private bus = inject(MessageBus)

  async place() {
    await this.bus.publish(OrderPlaced, { orderId: 'o-1', total: 42, placedAt: new Date() })
  }
}

@Injectable()
class Billing {
  @On(OrderPlaced)
  async onPlaced(order: OrderPlaced) {
    order.placedAt.getFullYear() // a Date: the schema coerced it
  }
}
```

A handler parameter of another type does not compile. Every handler validates the payload before it runs and gets the parsed data. A payload that does not match is rejected: the handler is not called, and the message goes to `<topic>.dlq` at once, without retries, since a retry cannot fix a payload. The reason is in the dead letter:

```text
Payload validation failed for 'order.placed': orderId: Invalid input: expected string, received undefined; total: Too small: expected number to be >0
```

The schema runs where the message is consumed because that is the side it protects. It also covers producers that never saw the contract's types: a service in another language, an older deployment, a message written by hand.

Docs: [Messaging → Event contracts](/docs/packages/messaging#event-contracts).

## Feature configs

`ConfigService` values are now a snapshot taken at startup and frozen: `config.get('ORIGINS').push(...)` throws instead of changing the value every other caller sees.

A feature module can own its variables with `defineConfig()`:

```ts
export const paymentsConfig = defineConfig(
  'payments',
  z.object({
    STRIPE_KEY: z.string(),
    CURRENCY: z.string().default('usd'),
  }),
)

@Injectable()
export class PaymentsService {
  private config = inject(paymentsConfig) // Readonly<{ STRIPE_KEY: string; CURRENCY: string }>
}

@Module({
  imports: [ConfigModule.register(paymentsConfig)],
  providers: [PaymentsService],
})
export class PaymentsModule {}
```

The schema is validated once at startup, and a failure names the config:

```text
[Miia] Config validation failed for 'payments':
  - STRIPE_KEY: Invalid input: expected string, received undefined
```

Docs: [Configuration → Feature configuration](/docs/core-concepts/configuration#feature-configuration).

## A rebuilt CLI

```bash
bun create miia my-app
npm create miia@latest my-app
deno run -A npm:create-miia my-app
```

`miia new` builds the project from template files for Bun, Node.js or Deno. The project is laid out for strict module boundaries, with a global `ConfigModule`, a validated env schema and tests next to the code. Every prompt has a flag (`--runtime`, `--pm`, `--features`, `--db`), and `-y` takes the defaults, for CI.

`miia add` adds features to a project that already exists: `jwt-auth` (working register, login and `me` routes), `swagger`, `cors`, `serve-static`, `rate-limit`, `biome`, and one database (`drizzle-postgres`, `drizzle-mysql`, `drizzle-sqlite`, `papr`, `mongoose`). It edits your files through the TypeScript compiler API and keeps the rest of each file byte for byte. When it cannot edit something safely, it says what to add by hand instead of guessing.

```bash
bunx miia add jwt-auth swagger drizzle-postgres
```

`miia g resource posts` writes a CRUD module: zod route schemas, `@Status(201)` and `@Status(204)`, `NotFoundException` for a missing id, an in-memory service and a `TestApp` test that passes without a database. `miia g table posts` writes a Drizzle table for the project's dialect and adds it to the schema file.

```text
$ bunx miia g resource posts
  UPDATE src/app/app.module.ts
  CREATE src/posts/posts.controller.ts
  CREATE src/posts/posts.module.ts
  CREATE src/posts/posts.service.ts
  CREATE src/posts/posts.test.ts
  CREATE src/posts/posts.types.ts
  CREATE src/posts/schemas/create-posts.schema.ts
  CREATE src/posts/schemas/posts-id-params.schema.ts
  CREATE src/posts/schemas/update-posts.schema.ts
```

Docs: [CLI](/docs/packages/cli).

## Smaller changes and fixes

- **Bundled apps keep their decorator metadata.** `"sideEffects": false` let wrangler, `bun build` and esbuild drop the `Symbol.metadata` polyfill, and a bundled app answered 404 on every route. A generated app now starts on workerd, the Cloudflare Workers runtime, as part of the release checks.
- **Router.** The trie backs up when a branch dead-ends: with `/users/:id` and `/users/*`, `GET /users/42/posts/1` reaches the wildcard instead of a 404. Each route reads its own param names.
- **Faster 404s and pipelines.** An app without global middleware answers an unmatched route without building an exception, and `compose()` follows koa-compose without an async wrapper per level.
- **CORS.** A preflight is an `OPTIONS` with both `Origin` and `Access-Control-Request-Method`, as the Fetch spec defines it; other `OPTIONS` requests reach their route. Any `origin` but `'*'` adds `Origin` to `Vary` on every response.
- **Responses.** `return ctx.res.redirect('/login')` works, a value returned under a custom `Content-Type` is sent, and `ctx.res.text()` / `html()` send `charset=utf-8`.
- **JWT.** A numeric `expiresIn` is seconds from signing. Before, `expiresIn: 3600` signed tokens that had expired in 1970.
- **Auth.** `fromHeader()` matches the scheme case-insensitively (`bearer <token>`), and `fromCookie()` matches the name literally.
- **serve-static.** Percent-encoded file names, index files in subdirectories, `etag: false` that really turns off conditional GET.
- **Adapters.** node-server and uws-server read a request body once, as a real `Request` does. node-server's early 413 keeps the connection and drains the upload, so the client gets the answer instead of a reset, and uws-server's `close()` waits for the requests in flight.
- **Logger.** `NO_COLOR` and a `colors` option keep escape codes out of log files.

## Upgrading from 0.8

The full list is in the changelog of each package, starting with [`@miiajs/core`](https://github.com/miiajs/miia/blob/main/packages/core/CHANGELOG.md). The changes most apps will hit:

| In 0.8 | In 0.9 |
| --- | --- |
| String tokens: `inject<T>('X')`, `@Injectable({ token })` | `createToken<T>('X')` with `provider(token, factory)`, or the class itself |
| `Container` and `runInContainerContext` exported | Build the app with `new Miia().provide()` / `register()`, read providers with `app.get()`, test with `TestApp` |
| Any provider can inject any other | A provider injected from another module must be in that module's `exports`, and the injecting module must import it. Infrastructure: `configure(options, { global: true })` |
| A module configured twice: the first configuration wins | Throws `X is configured twice`. Configure it once and import the class bare elsewhere; a second connection is a named configuration |
| A request-scoped provider injected anywhere | `ctx.resolve(Token)` in a handler, middleware or guard, or `inject()` in another request-scoped provider. A singleton that injects one fails at startup |
| `@On('topic')`, `publish('topic', payload)` | `defineEvent('topic', schema)`, passed to `@On()` and `publish()` |
| `ConfigService` without a schema reads the live `process.env`; values from a schema can be mutated | A snapshot taken at startup, frozen. Set `process.env` before `init()` or pass `env`; copy an object or array value before mutating it |
| `DiscoveryService.getSingletons()` | `getClassesWithMeta(key)` / `getMethodsWithMeta(key)`, called from `onInit()` or `onReady()` |
| `register()`, `use()`, `useGuard()`, `addRoute()` at any time | `register()` / `provide()` before the graph is processed, `use()` / `useGuard()` / `addRoute()` before `init()`. A route registered twice throws |
| `TestApp.override()` of any token | An override of a token nothing provides throws on `compile()`. A plain-object mock is not discovered: an `@On` handler or a controller needs a named subclass (`class FakeHandler extends Handler {}`) |
| `cors()` answers every `OPTIONS` with 204 | Only a real preflight. An `OPTIONS` without `Access-Control-Request-Method` reaches the router |

One change in routing can surprise an app that serves a SPA at `/` next to an API under `/api`: the SPA wildcard now also answers an unknown `GET /api/...`, since the router backs up to it. To keep those a 404, add a catch-all under the API. With `globalPrefix: '/api'` on the app:

```ts
app.addRoute('GET', '/*', () => { throw new NotFoundException() }, { skipGlobalGuards: true })
```

Without a global prefix the path is written out, `'/api/*'`. The recipe is in [serve-static → SPA in front of a prefixed API](/docs/packages/serve-static#spa-in-front-of-a-prefixed-api).

If you know NestJS, [Coming from NestJS](/docs/getting-started/coming-from-nest) maps each Nest concept to its MiiaJS form, 0.9 changes included.

Docs: [miiajs.com/docs](/docs/getting-started) · GitHub: [miiajs/miia](https://github.com/miiajs/miia) · Examples: [examples/](https://github.com/miiajs/miia/tree/main/examples)
