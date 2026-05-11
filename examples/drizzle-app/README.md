# drizzle-app

CRUD API built with `@miiajs/core`, `@miiajs/drizzle`, and PostgreSQL.

Demonstrates module configuration, schema definition, type-safe injection via `inject(db)` with `drizzleDb<TDb>()`, and migrations with [drizzle-kit](https://orm.drizzle.team/docs/kit-overview).

## Prerequisites

- Bun >=1.3.11 (or Node.js >=22.22.1)
- A running PostgreSQL instance
- **Monorepo packages built** - run once from the repo root:
  ```sh
  bun install && bun run build
  ```

## Quick start

```sh
cp .env.example .env    # edit DATABASE_URL if needed
bun run db:migrate      # apply the initial migration
bun run dev
```

```sh
curl -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com"}'

curl http://localhost:3000/users
```

## Project structure

| File | Description |
| --- | --- |
| `src/app.module.ts` | Root module - configures Drizzle (passes `schema`) and imports feature modules |
| `src/db.schema.ts` | Schema barrel - re-exports every table for `typeof schema` |
| `src/db.ts` | `export const db = drizzleDb<PostgresJsDatabase<typeof schema>>()` - typed DI token |
| `src/user/user.schema.ts` | Drizzle table definition |
| `src/user/user.module.ts` | Feature module - exposes controller and service |
| `src/user/user.service.ts` | Service - uses `inject(db)` for DB access |
| `src/user/user.controller.ts` | Controller - REST endpoints for `/users` |
| `drizzle.config.ts` | drizzle-kit config for migration generation |
| `drizzle/` | Committed SQL migrations and snapshots |