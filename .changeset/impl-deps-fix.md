---
'@miiajs/swagger': patch
'@miiajs/messaging-redis': patch
---

Auto-install internal implementation dependencies.

`@miiajs/swagger` requires `@miiajs/serve-static` to serve the Swagger UI bundle, and `@miiajs/messaging-redis` requires `@miiajs/messaging` as the abstract bus it implements a transport for. In `0.1.1` these were declared as `peerDependencies`, which meant `bun add @miiajs/swagger` did not install `@miiajs/serve-static` automatically and the consumer had to know about it and add it manually.

Move both back to `dependencies` (as plain semver `^0.1.1`, not `workspace:` - the workspace protocol would still leak into the published package). `@miiajs/core` stays a `peerDependency` because it is the framework root and a single instance must be shared across all plugins.
