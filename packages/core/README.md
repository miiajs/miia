# MiiaJS

The lightweight, decorator-driven HTTP framework for TypeScript.

Build structured, type-safe APIs with decorators, dependency injection, and middleware. Deploy to any runtime - Bun, Deno, Node.js, serverless, or edge.

## Why MiiaJS?

- **TC39 Native Decorators** - no `reflect-metadata`, no experimental TypeScript flags
- **Web Standards** - built on the `Request`/`Response` API, no proprietary abstractions
- **Multi-Runtime** - runs on Bun, Deno, Node.js, Cloudflare Workers, AWS Lambda
- **Koa-style Middleware** - clean onion model replaces interceptors, pipes, and filters
- **Flat DI** - per-app container with `inject()` function, no global singletons
- **ESM-only** - ES2025 target, `nodenext` module resolution

## Performance

Up to **17% faster** than Hono | Up to **31% faster** than NestJS+Fastify \*

> \* Realistic API benchmarks on Bun. Results vary by runtime. [See full benchmarks →](https://miiajs.com/benchmarks)

## Ecosystem

| Package | Description |
| --- | --- |
| `@miiajs/core` | DI, decorators, router, middleware, exceptions |
| `@miiajs/config` | ConfigModule, ConfigService, validated env |
| `@miiajs/serve-static` | Static file serving with Range, ETag, charset, SPA fallback |
| `@miiajs/cli` | Dev server, build, start, type checking, project scaffolding |
| `@miiajs/node-server` | Node.js HTTP server adapter |
| `@miiajs/uws-server` | uWebSockets.js HTTP server adapter |
| `@miiajs/auth` | Strategy primitives, AuthGuard, token extractors |
| `@miiajs/jwt` | Injectable JWT sign/verify service (jose wrapper) |
| `@miiajs/messaging` | Decorator-driven message bus, retry, DLQ, idempotency, named buses |
| `@miiajs/messaging-redis` | Redis Streams transport for `@miiajs/messaging` |
| `@miiajs/drizzle` | Drizzle ORM integration (PostgreSQL, MySQL, SQLite) |
| `@miiajs/mongoose` | MongoDB integration via Mongoose with injectable models |
| `@miiajs/papr` | MongoDB integration via Papr |
| `@miiajs/swagger` | OpenAPI 3.1 spec generation, Swagger UI |

## Quick start

```bash
npx @miiajs/cli new my-app
cd my-app
npm run dev
```

## Documentation

Full documentation, guides, and API reference:

**[miiajs.com/docs](https://miiajs.com/docs)**

## License

MIT
