---
'@miiajs/cli': minor
---

`miia add <feature...>` applies add-ons to an existing project through the same code as `miia new --features/--db`: jwt-auth (working register/login/me with an in-memory user store, `Bun.password` on Bun and scrypt elsewhere), swagger, cors, serve-static, rate-limit, biome, drizzle-postgres, drizzle-mysql, drizzle-sqlite (Bun and Node.js), papr and mongoose. Infrastructure modules are `{ global: true }`, `AuthModule` is global with `exports: [JwtAuth]`. Installed add-ons are skipped, a second database is refused, a dirty git tree asks first, `--dry-run` prints the changes, and files a codemod cannot edit get a warning instead of a guess. Third-party versions in the templates are checked against the peer ranges of the packages.
