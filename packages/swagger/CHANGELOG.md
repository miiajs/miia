# @miiajs/swagger

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
