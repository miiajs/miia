# @miiajs/mongoose

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
