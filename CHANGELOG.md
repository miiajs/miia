# Changelog

All notable changes to MiiaJS are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-11

First public release.

### Packages

- `@miiajs/core` - DI, decorators, router, middleware, exceptions, CORS, logger
- `@miiajs/config` - Zod-validated env config (works with any `ZodLike` validator)
- `@miiajs/serve-static` - Static file serving with Range, weak ETag, conditional GET, charset negotiation, SPA fallback, dotfile guard, symlink-safe paths
- `@miiajs/node-server` - Node.js HTTP adapter (optimized and native modes)
- `@miiajs/uws-server` - uWebSockets.js HTTP adapter (optimized and native modes)
- `@miiajs/auth` - strategy primitives, AuthGuard, token extractors
- `@miiajs/jwt` - injectable JWT sign/verify service (jose wrapper)
- `@miiajs/messaging` - decorator-driven message bus, retry with auto-DLQ, idempotency, named buses, W3C tracing
- `@miiajs/messaging-redis` - Redis Streams transport for `@miiajs/messaging` (consumer groups, ZSET retry, idempotency store)
- `@miiajs/drizzle` - Drizzle ORM (PostgreSQL, MySQL, SQLite)
- `@miiajs/papr` - MongoDB via Papr
- `@miiajs/mongoose` - MongoDB via Mongoose
- `@miiajs/swagger` - OpenAPI 3.1 + Swagger UI
- `@miiajs/cli` - `miia dev`, `build`, `start`, `check`, `new`, `generate`

### Notes

- All packages require Node.js ≥22.22.1, Bun ≥1.3.11, or Deno ≥2.6.1.
- `@miiajs/papr` minimum Node version raised from 20.0.0 to 22.22.1 for consistency with the rest of the monorepo.
- `@miiajs/uws-server` requires `uWebSockets.js` ≥20.61.0; this version is incompatible with the glibc shipped in Debian 12. See `packages/uws-server/README.md` Troubleshooting for workarounds.
