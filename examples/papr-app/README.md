# papr-app

CRUD API built with `@miiajs/core`, `@miiajs/papr`, and MongoDB.

Demonstrates module configuration, model registration via `defineModel()`, and type-safe injection with the standard `inject()` helper.

## Prerequisites

- Bun >=1.3.11 (or Node.js >=22.22.1)
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

## Project structure

| File | Description |
| --- | --- |
| `src/app.module.ts` | Root module - configures Papr and imports feature modules |
| `src/user/user.schema.ts` | Papr schema and model definition via `defineModel()` |
| `src/user/user.module.ts` | Feature module - registers model via `PaprModule.register()` |
| `src/user/user.service.ts` | Service - uses `inject(User)` and `inject(paprDb())` for typed model and raw db access |
| `src/user/user.controller.ts` | Controller - REST endpoints for `/users` |
