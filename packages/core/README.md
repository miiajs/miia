# MiiaJS

The lightweight, decorator-driven HTTP framework for TypeScript.

Build structured, type-safe APIs with decorators, dependency injection, and middleware. Deploy to any runtime - Bun, Deno, Node.js, serverless, or edge.

## Why MiiaJS?

- **TC39 Native Decorators** - no `reflect-metadata`, no experimental TypeScript flags
- **Web Standards** - built on the `Request`/`Response` API, no proprietary abstractions
- **Multi-Runtime** - runs on Bun, Deno, Node.js and Cloudflare Workers; anywhere else through `app.fetch`
- **Koa-style Middleware** - clean onion model replaces interceptors, pipes, and filters
- **Module boundaries over one container** - per-app container with `inject()`, `imports` / `exports` / `global` checked at startup
- **ESM-only** - ES2025 target, `nodenext` module resolution

## Performance

Benchmarks against Hono, Elysia, Fastify and NestJS on Bun, Node.js and Deno: [miiajs.com/benchmarks](https://miiajs.com/benchmarks).

## Ecosystem

| Package | Description |
| --- | --- |
| `@miiajs/core` | DI, decorators, router, middleware, exceptions |
| `@miiajs/config` | ConfigModule, ConfigService, validated env |
| `@miiajs/serve-static` | Static file serving with Range, ETag, charset, SPA fallback |
| `@miiajs/cli` | Dev server, build, start, type checking, project scaffolding |
| `@miiajs/testing` | `TestApp` harness for unit and integration tests |
| `@miiajs/node-server` | Node.js HTTP server adapter |
| `@miiajs/uws-server` | uWebSockets.js HTTP server adapter |
| `@miiajs/auth` | Auth primitives - `AuthProvider`, `AuthGuard`, token extractors |
| `@miiajs/jwt` | Injectable JWT sign/verify service (jose wrapper) |
| `@miiajs/rate-limit` | Fixed-window rate limiting - guard, decorators, perimeter middleware |
| `@miiajs/multipart` | Streaming `multipart/form-data` uploads with per-file limits |
| `@miiajs/messaging` | Decorator-driven message bus, retry, DLQ, idempotency, named buses |
| `@miiajs/messaging-redis` | Redis Streams transport for `@miiajs/messaging` |
| `@miiajs/drizzle` | Drizzle ORM integration (PostgreSQL, MySQL, SQLite) |
| `@miiajs/mongoose` | MongoDB integration via Mongoose with injectable models |
| `@miiajs/papr` | MongoDB integration via Papr |
| `@miiajs/swagger` | OpenAPI 3.1 spec generation, Swagger UI |

## Quick start

```bash
bun create miia my-app
cd my-app
bun run dev
```

With npm: `npm create miia@latest my-app`, then `npm run dev`.

## Documentation

Full documentation, guides, and API reference:

**[miiajs.com/docs](https://miiajs.com/docs)**

## License

MIT
