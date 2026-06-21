# MiiaJS

Lightweight, decorator-driven HTTP framework for TypeScript.

Inspired by Angular/NestJS architectural ideas - decorator-driven DI, controllers, modules - Koa's onion-model middleware, and Hono's multi-runtime, lightweight philosophy. Built from scratch on modern standards: TC39 native decorators, Web API (Request/Response), ESM-only.

## Features

- **Runtime-agnostic** - Bun, Deno natively; Node.js and uWebSockets.js via server packages
- **TC39 decorators** - no reflect-metadata, no experimental flags
- **Koa-style middleware** - onion model, replaces interceptors/pipes/filters
- **Per-app DI container** - context-based `inject()`, no global singletons
- **Zod-like validation** - optional, via `@ValidateBody`, `@ValidateQuery`, `@ValidateParams`
- **Database integrations** - Drizzle ORM (Postgres/MySQL/SQLite), MongoDB via Papr or Mongoose

## Installation

```sh
bun add @miiajs/core
# or
npm install @miiajs/core
# or
pnpm add @miiajs/core
# or
yarn add @miiajs/core
```

## Quick start

```ts
import { Controller, Get, Post, Module, Miia } from '@miiajs/core'
import type { RequestContext } from '@miiajs/core'

interface CreateMessage {
  text: string
}

@Controller('/hello')
class HelloController {
  @Get('/')
  greet() {
    return { message: 'Hello, World!' }
  }

  @Post('/')
  async echo(ctx: RequestContext) {
    const body = await ctx.json<CreateMessage>()
    return { echoed: body.text }
  }
}

@Module({ controllers: [HelloController] })
class AppModule {}

const app = new Miia().register(AppModule)

// Bun / Deno - native runtime, no adapter needed
await app.listen(3000)

// Node.js - pass the adapter as the third argument
// import { serve } from '@miiajs/node-server'
// await app.listen(3000, '0.0.0.0', serve)
```

> Body access uses `await ctx.json<T>()` / `await ctx.text()` with a per-request
> cache - the same parsed value is returned on subsequent calls. The generic
> parameter is a TypeScript hint only (no runtime validation). For runtime
> validation of request bodies, use `@ValidateBody(schema)` - downstream
> handlers see validated (and possibly transformed) data.

## Packages

| Package | Description |
|---------|-------------|
| `@miiajs/core` | DI, decorators, router, middleware, exceptions |
| `@miiajs/config` | ConfigModule, ConfigService, validated env |
| `@miiajs/serve-static` | Static file serving with Range, ETag, charset, SPA fallback |
| `@miiajs/node-server` | Node.js HTTP server |
| `@miiajs/uws-server` | uWebSockets.js HTTP server |
| `@miiajs/auth` | Strategy primitives, AuthGuard, token extractors |
| `@miiajs/jwt` | Injectable JWT sign/verify service (jose wrapper) |
| `@miiajs/rate-limit` | Fixed-window rate limiting: middleware, guard, decorators, pluggable stores |
| `@miiajs/messaging` | Decorator-driven event bus, retry, DLQ, idempotency, named buses |
| `@miiajs/messaging-redis` | Redis Streams transport for `@miiajs/messaging` |
| `@miiajs/drizzle` | Drizzle ORM integration (Postgres, MySQL, SQLite) |
| `@miiajs/papr` | MongoDB integration via Papr |
| `@miiajs/mongoose` | MongoDB integration via Mongoose |
| `@miiajs/swagger` | OpenAPI 3.1 spec generation, Swagger UI |
| `@miiajs/cli` | Dev CLI: `dev`, `build`, `start`, `check`, `new`, `generate` |

## Requirements

- Node.js >= 22.22.1, Bun >= 1.3.11, or Deno >= 2.6.1
- TypeScript >= 5.7

## Documentation

Full documentation: https://miiajs.com
Source & issues: https://github.com/miiajs/miia

## Author

Ruslan Matiushev

## License

MIT
