# drizzle-app

CRUD API built with `@miiajs/core`, `@miiajs/drizzle`, and PostgreSQL.

Demonstrates module configuration, schema definition, type-safe injection via `inject(db)` with `drizzleDb<TDb>()`, and migrations with [drizzle-kit](https://orm.drizzle.team/docs/kit-overview).

## Prerequisites

- Bun >=1.4.0 (or Node.js >=22.12.0)
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

## Tests

```sh
DATABASE_TEST_URL=postgres://postgres:postgres@localhost:5432/miia_test bun test
```

The tests apply the migrations to the database they are given and are skipped without `DATABASE_TEST_URL`.

## Project structure

| File | Description |
| --- | --- |
| `src/app.module.ts` | Root module - configures Drizzle (passes `schema`) and imports feature modules |
| `src/db.schema.ts` | Schema barrel - re-exports every table for `typeof schema` |
| `src/db.ts` | `export const db = drizzleDb<PostgresJsDatabase<typeof schema>>()` - typed DI token |
| `src/user/user.table.ts` | Drizzle table definition |
| `src/user/user.module.ts` | Feature module - exposes controller and service; injects `db` without importing `DrizzleModule`, which the root configures with `{ global: true }` |
| `src/user/user.service.ts` | Service - uses `inject(db)` for DB access |
| `src/user/user.controller.ts` | Controller - REST endpoints for `/users`, request schemas in the route decorators |
| `src/user/schemas/` | Zod schemas of the request body and the `:id` param (a positive 4-byte integer, the range of a Postgres serial) |
| `src/user/user.test.ts` | `TestApp` tests against `DATABASE_TEST_URL` |
| `drizzle.config.ts` | drizzle-kit config for migration generation |
| `drizzle/` | Committed SQL migrations and snapshots |