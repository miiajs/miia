# mongoose-app

CRUD API built with `@miiajs/core`, `@miiajs/mongoose`, and MongoDB.

Demonstrates module configuration, model registration via `defineModel()`, and type-safe injection with the standard `inject()` helper.

## Prerequisites

- Bun >=1.4.0 (or Node.js >=22.12.0)
- A running MongoDB instance
- **Monorepo packages built** - run once from the repo root:
  ```sh
  bun install && bun run build
  ```

## Quick start

```sh
cp .env.example .env    # edit MONGODB_URL if needed
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
bun test
```

`src/user/user.test.ts` needs no database: `TestApp` replaces the `User` model with the real one on a connection that never opens (Mongoose casts the id before it needs one), and the tests check the 422 for an id that is not an ObjectId and that the `:id` schema accepts one in hex.

## Project structure

| File | Description |
| --- | --- |
| `src/app.module.ts` | Root module - configures Config and Mongoose with `{ global: true }`, so feature modules and their `register()` models see them without an import, and imports feature modules |
| `src/user/user.model.ts` | Mongoose schema and model definition via `defineModel()` |
| `src/user/user.module.ts` | Feature module - registers model via `MongooseModule.register()` |
| `src/user/user.service.ts` | Service - uses `inject(User)` and `inject(mongooseConnection())` for typed model and raw connection access |
| `src/user/user.controller.ts` | Controller - REST endpoints for `/users`, request schemas in the route decorators |
| `src/user/schemas/` | Zod schemas of the request body and the `:id` param (a 24-character hex ObjectId) |
| `src/user/user.test.ts` | `TestApp` tests without a database |
