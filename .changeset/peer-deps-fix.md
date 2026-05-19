---
'@miiajs/auth': patch
'@miiajs/config': patch
'@miiajs/drizzle': patch
'@miiajs/jwt': patch
'@miiajs/messaging': patch
'@miiajs/messaging-redis': patch
'@miiajs/mongoose': patch
'@miiajs/papr': patch
'@miiajs/serve-static': patch
'@miiajs/swagger': patch
---

Fix `workspace:*` leaking into published packages.

The `0.1.0` release published `"@miiajs/core": "workspace:*"` (and other internal `@miiajs/*` deps) into the npm registry, causing `yarn add @miiajs/<pkg>` to fail with `Couldn't find any versions for @miiajs/core that matches workspace:*`. `changeset publish` invokes `npm publish` under the hood, and npm does not resolve the workspace protocol when the lockfile is `bun.lock`.

Internal `@miiajs/*` dependencies are now declared as `peerDependencies` (`^0.1.0`, plain semver) plus `devDependencies` (`workspace:*` for local linking). This is the canonical pattern for framework plugins (NestJS-style):

- Guarantees a single `@miiajs/core` instance in the consumer's `node_modules` (required for DI and decorator metadata to work).
- Lets the consumer control the `@miiajs/core` version they install.
- Eliminates `workspace:*` from the published `package.json` `dependencies`.

Affected packages: `auth`, `config`, `drizzle`, `jwt`, `messaging`, `messaging-redis`, `mongoose`, `papr`, `serve-static`, `swagger`.
