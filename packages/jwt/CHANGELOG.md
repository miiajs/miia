# @miiajs/jwt

## 0.9.0

### Minor Changes

- [`f16fbc1`](https://github.com/miiajs/miia/commit/f16fbc1e2f12ee5bc5ae28857d61ccbb2199358b) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `configure()` takes `{ global: true }` in its second argument (`{ name?, global? }` for drizzle, papr, mongoose and messaging) and declares its `exports`, which decide what other modules see of it:

  - `ConfigModule`, `JwtModule` and `SwaggerModule` export `ConfigService`, `JwtService` and `SwaggerService`; `RateLimitModule` exports the options its guards read
  - `DrizzleModule`, `PaprModule` and `MongooseModule` export the db / connection token, papr and mongoose also the internals their `register()` models resolve; `MessagingModule` exports its bus
  - papr and mongoose `register()` exports its models, and its module is named `PaprModule.register([users])` / `MongooseModule.register([User])` in errors and the start-up log

  Breaking: messaging checks the `bus` of every `@On` against the `MessageBus` instances of the app instead of the container. A bus token overridden with a plain object no longer counts as a bus, so an `@On` that targets it fails at startup - replace the bus through its configuration, or override the token with a factory that builds a `MessageBus` (or a subclass) under the same name.

- [`c0b1422`](https://github.com/miiajs/miia/commit/c0b1422b885574d3d604f5cfbe3c72e997967895) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Option tokens are typed `createToken()` objects and stay inside their packages. "No provider" errors name the module to import: `JwtService is provided by JwtModule.configure()`, likewise for `ConfigService` and `SwaggerService`, and for the JWT and Swagger options when the service is provided without its module. Breaking:

  - `JWT_OPTIONS`, `RATE_LIMIT_OPTIONS` and `SWAGGER_OPTIONS` are no longer exported - configure the packages through `JwtModule.configure()`, `RateLimitModule.configure()` and `SwaggerModule.configure()`
  - `ConfigService` is no longer registered under the string `'ConfigService'` - resolve it by the class

### Patch Changes

- [`40b7bd0`](https://github.com/miiajs/miia/commit/40b7bd0c44dd2b4553890ee30879c7cda3f8da04) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A numeric `expiresIn` or `notBefore` is a number of seconds from signing, as the options table says (`expiresIn: 3600` is an hour). It used to reach `jose` as an absolute timestamp, so `expiresIn: 3600` signed tokens that had expired in 1970 and every `verify()` rejected them. Time span strings (`'1h'`, `'30s'`) are unchanged.

- [`40b7bd0`](https://github.com/miiajs/miia/commit/40b7bd0c44dd2b4553890ee30879c7cda3f8da04) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - A key passed to `sign()` or `verify()` wins over the key of the module, as "per-call options override module defaults" promises. A module configured with `secret` used to sign with that secret even when the call passed a `privateKey`, and fail on the RS256/HMAC mismatch. The algorithm of a per-call key is the call's `algorithm` (`algorithms` for `verify()`), else the module's when it fits the kind of key (`HS*` for a secret, any other for a key pair), else `HS256` for a secret and `RS256` for a key.

## 0.8.0

### Patch Changes

- [`1a8b039`](https://github.com/miiajs/miia/commit/1a8b0392d5188d297922209831b3d2edbdfe7de7) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Default the signing algorithm by key type, like `verify()`

  `sign()` put `HS256` in the token header whenever `algorithm` was not set, so signing with a `privateKey` (PEM or
  `CryptoKey`) failed. It now defaults to `HS256` with a `secret` and `RS256` with a key, the same rule `verify()` and the
  PEM import already use. EC and Ed keys still need an explicit `algorithm`.

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
