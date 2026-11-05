# @miiajs/messaging

## 0.9.0

### Minor Changes

- [`ef974a2`](https://github.com/miiajs/miia/commit/ef974a2e961ad7ced0632ee21a144d4cc324ea27) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `DiscoveryService` returns only what carries a metadata key: new `getClassesWithMeta(key)` (`{ instance, ctor, metadata }` per instance whose class has metadata under `key`, type `DiscoveredClass`) next to `getMethodsWithMeta(key)`. Metadata is read from the class of each instance, so a handler class behind a factory provider is discovered; an instance under two tokens is listed once, and a lazy proxy is skipped. Swagger collects controllers through `getClassesWithMeta(RESOLVED_PREFIX)`. Breaking:

  - `DiscoveryService.getSingletons()` is removed - use `getClassesWithMeta(key)`
  - a factory-provided instance is discovered by its own class, and a plain-object mock (`TestApp.override(Handler, { ... })`) is not discovered at all: its `@On` methods are not subscribed and a mocked controller drops out of the swagger spec - override with a named subclass (`class FakeHandler extends Handler {}`) to keep it
  - calling `getClassesWithMeta()` / `getMethodsWithMeta()` before every provider is constructed (a constructor, a field initializer, `app.get()` without `init()`) throws - call them from `onReady()` or `onInit()`
  - messaging: consumer group names and default idempotency keys come from the class of the handler instance - a factory that returns a subclass for a class token renames the group, and retries parked under the old group are orphaned; the same `@On` class provided twice fails at startup

- [`ef974a2`](https://github.com/miiajs/miia/commit/ef974a2e961ad7ced0632ee21a144d4cc324ea27) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Handlers drain in `onShutdown()`, before any provider's `onDestroy()`: the bus unsubscribes and the transports stop consuming and wait for in-flight handlers there, so a database your handlers write to closes after they finish, wherever its module sits. New optional `MessageTransport.onShutdown()`; the in-memory and Redis transports implement it, and their `onDestroy()` drains first when called alone. The Redis transport destroys every broadcast group it subscribed to in `onDestroy()`, including ones unsubscribed earlier, and rejects `subscribe()` once shutdown has started (`subscribe() after shutdown started`) - one still creating its group or connecting its lanes when `onShutdown()` starts closes its lanes and rejects too, so no consumer loop outlives the transport. Breaking: `MessageBus.onDestroy()` is renamed to `onShutdown()`.

- [`f16fbc1`](https://github.com/miiajs/miia/commit/f16fbc1e2f12ee5bc5ae28857d61ccbb2199358b) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `configure()` takes `{ global: true }` in its second argument (`{ name?, global? }` for drizzle, papr, mongoose and messaging) and declares its `exports`, which decide what other modules see of it:

  - `ConfigModule`, `JwtModule` and `SwaggerModule` export `ConfigService`, `JwtService` and `SwaggerService`; `RateLimitModule` exports the options its guards read
  - `DrizzleModule`, `PaprModule` and `MongooseModule` export the db / connection token, papr and mongoose also the internals their `register()` models resolve; `MessagingModule` exports its bus
  - papr and mongoose `register()` exports its models, and its module is named `PaprModule.register([users])` / `MongooseModule.register([User])` in errors and the start-up log

  Breaking: messaging checks the `bus` of every `@On` against the `MessageBus` instances of the app instead of the container. A bus token overridden with a plain object no longer counts as a bus, so an `@On` that targets it fails at startup - replace the bus through its configuration, or override the token with a factory that builds a `MessageBus` (or a subclass) under the same name.

- [`c0b1422`](https://github.com/miiajs/miia/commit/c0b1422b885574d3d604f5cfbe3c72e997967895) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A named bus is injected through the typed token `messageBus(name)`, and a named `MessagingModule.configure()` is the same module class with a `name`. "No provider" errors name the call that provides a bus: `MessageBus(kafka) is provided by MessagingModule.configure(opts, { name: 'kafka' })`. Configuring one bus name twice now throws `configured twice`, and a named bus can be replaced in tests with `TestApp.override(MessagingModule, MessagingModule.configure(test, { name: 'kafka' }))`. Breaking:

  - `MESSAGE_TRANSPORT`, `IDEMPOTENCY_STORE`, `getMessageBusToken()`, `getMessageTransportToken()` and `getIdempotencyStoreToken()` are no longer exported; the transport and idempotency store tokens are internal
  - a named bus is `inject(messageBus('kafka'))` instead of `inject<MessageBus>(getMessageBusToken('kafka') as string)`; the default bus stays `inject(MessageBus)`
  - the bus name moved into an options object: `MessagingModule.configure(opts, { name: 'kafka' })` instead of `MessagingModule.configure(opts, 'kafka')`, and a named `configure()` returns `{ module: MessagingModule, name }` instead of a new anonymous module class per call

- [`305c3f5`](https://github.com/miiajs/miia/commit/305c3f511d28152064f79aada4d16a454314081d) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Events are contracts: `defineEvent(topic, schema?)` returns a frozen `{ topic, schema }`, and `MessageBus.publish(event, payload, meta?)` and `@On(event, options?)` take it. The handler's parameter is typed from the schema's output (`EventPayload<typeof E>`, `unknown` without a schema), and `publish()` takes the schema's input (`EventInput<typeof E>`) without running the schema. Each `@On` handler validates the payload before it runs and before an `@Idempotent` claim, and gets the parsed data, as does the idempotency `key()`. A payload that does not match, or a schema that throws, is dead-lettered at once without retry by both the in-memory and the Redis Streams transport (`meta.lastError` is `Payload validation failed for '<topic>': <path>: <message>`, `meta.attempt` is 1), or dropped when the DLQ is off. `dlqEvent(event)` is the schema-less contract of `<topic>.dlq` for dead-letter handlers. A schema describes the JSON form of the payload, which is what a Redis consumer gets: `z.coerce.date()`, not `z.date()`. New exports: `defineEvent`, `dlqEvent` and the types `EventContract`, `EventPayload`, `EventInput`, `OnOptions`. Breaking:

  - `publish()` and `@On` no longer take a string topic: `bus.publish(OrderPlaced, order)` and `@On(OrderPlaced)` with `const OrderPlaced = defineEvent('order.placed', schema)` instead of `bus.publish('order.placed', order)` and `@On('order.placed')`; a string throws a `TypeError` that names the fix
  - the handler's payload type comes from the event: a parameter of another type does not compile, and a handler of an event without a schema gets `unknown`
  - `HandlerResult` has a third status, `{ status: 'reject', error }`, which is never retried and goes straight to the DLQ (or is dropped when `dlq` is off); a custom `MessageTransport` must handle it

### Patch Changes

- [`f34144d`](https://github.com/miiajs/miia/commit/f34144d52e541f85bebfcd6860a0a4f0d0aede25) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - The options factory of `MessagingModule.configure((resolve) => ...)` runs once per app instead of once per provider, so it builds one transport and one idempotency store instead of three of each. `@On(topic, { bus: '' })` subscribes to the default bus instead of passing the startup check and never subscribing.

- [`b23625a`](https://github.com/miiajs/miia/commit/b23625afb12ea63fdec779edb3cfa99a752a4a6f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `@Idempotent` takes the payload type from its `key` function, so `key: (p: Payment) => p.id` compiles without casting the payload from `unknown`.

## 0.8.0

### Minor Changes

- [`0481c5c`](https://github.com/miiajs/miia/commit/0481c5c596509a93090c46dc57a6d8a5b078dd0e) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Give every process its own broadcast group

  Broadcast groups now end in `<hostname>_<pid>_<token>`, with a random token drawn once per process, where they ended in
  `<hostname>_<pid>`. Replicas that share hostname and pid - host-network containers that all run as pid 1 - derived the
  same group, split its copies between them, and the first to shut down destroyed it for the others. Each now gets its
  own group and its own copy of every message. The token is kept on `globalThis`, so two copies of `@miiajs/messaging`
  in one process agree on it.

  The Redis transport reads the owner off each broadcast group's name instead of computing it, so its liveness key always
  matches the group the bus formed, and its orphan cleanup recognises both shapes: groups left by releases before the
  token are still removed once their owner is gone. A broadcast group subscribed directly under a name without that
  suffix gets no liveness key and no orphan cleanup.

- [`f513194`](https://github.com/miiajs/miia/commit/f5131942f31a0493790b6e7981b162133f969e2d) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add `initialPosition` to choose where a new subscription starts reading

  A consumer group created after entries were published never saw them: every group started at the end of the topic,
  so a message published before a worker's first start, or before a new handler was deployed, was not delivered. That
  stays the default, and it is now a choice per handler with a written contract.

  `@On(topic, { initialPosition })` sets it per handler, `MessagingModule.configure({ initialPosition })` sets a bus
  default. Values:

  - `'latest'` - only entries published after the group is created. Default, no behaviour change.
  - `'earliest'` - everything the broker still retains for the topic.
  - `{ since: ms }` - entries from the last `since` milliseconds, plus everything after. `since` must be a positive
    integer.

  The position applies only when the broker-side group is created for the first time; an existing group is never moved.
  Broadcast handlers always start at `'latest'` - the bus default does not reach them, and an explicit `'earliest'` or
  `{ since }` on one throws at startup. Handlers on one bus that share an explicit `group` must resolve to the same
  position, or startup throws.

  **Transport contract.** `MessageTransport` gains an optional `supportedInitialPositions`, validated at startup like
  `supportedModes`. A transport that does not declare it supports `'latest'` only, so a handler asking for more fails at
  startup instead of silently starting at the end. `InMemoryTransport` declares all three - it retains nothing, so each
  means "from now".

  **Redis.** `XGROUP CREATE` starts at `$` for `'latest'`, `0` for `'earliest'`, and `<TIME - since>-0` for a window,
  measured on the Redis clock (the process clock only when `TIME` is denied, with one warning). Creating a group now logs
  `Created consumer group <group> on <topic> at <id>`.

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

### Patch Changes

- [`1d9fd9f`](https://github.com/miiajs/miia/commit/1d9fd9f1418170c6db0337640e8b27d3b2bce010) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Stop nesting dead-letter records in `InMemoryTransport`

  A message that had already been dead-lettered and then failed again on its `<topic>.dlq` consumer was written to
  `<topic>.dlq.dlq`, and so on for every level of DLQ consumer. It is now dropped with an error log instead, which
  is what `@miiajs/messaging-redis` does - the default dev/test transport no longer disagrees with the one running
  in production.

  Detection is the `meta.lastError` marker the transport itself writes when it dead-letters a record, not the topic
  name: an ordinary topic a user chose to call `billing.dlq` still dead-letters normally.

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
