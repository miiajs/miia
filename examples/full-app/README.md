# full-app

End-to-end [MiiaJS](../../README.md) example: Drizzle + Auth/JWT + Roles + Swagger + CORS + request logging, wired into a small CRUD API.

## What's inside

- **Auth** (`src/auth/`) - JWT + Local strategies, register / login / me endpoints, password hashing with `@node-rs/argon2`
- **Roles guard** (`src/auth/guards/roles.guard.ts`) - custom method decorator `@Roles('admin')` backed by `CanActivate`
- **Users CRUD** (`src/users/`) - paginated list, get by id, update (with policy), admin-only delete
- **Drizzle + PostgreSQL** - schema at `src/users/users.schema.ts`, connection via `DrizzleModule.configure`
- **Swagger** - OpenAPI 3.1 spec generated from decorators, UI at `/api/docs/`
- **Middleware** (`src/common/middleware/`) - `requestLogger`, `responseTime`, plus `cors()` from core
- **Validation** - Zod schemas via `@ValidateBody`, `@ValidateQuery`, `@ValidateParams`
- **Lifecycle hook** - `UsersService.onReady()` seeds a default admin in dev mode
- **Static files** - `public/index.html` landing served via `@miiajs/serve-static`

## Quick start

```sh
# 1. Start a PostgreSQL instance (Docker one-liner)
docker run -d --name miia-pg \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=full_app \
  postgres:16

# 2. Install deps (from the monorepo root)
cd ../..
bun install

# 3. Configure environment
cd examples/full-app
cp .env.example .env

# 4. Push the Drizzle schema
bun x drizzle-kit push

# 5. Run the dev server
bun run dev
```

Open:

- <http://localhost:3030/> → landing page
- <http://localhost:3030/api/docs/> → Swagger UI
- <http://localhost:3030/api/docs/json> → raw OpenAPI spec

## Dev credentials

On first boot in dev mode, `UsersService.onReady()` seeds an admin user:

- **Email:** `admin@miiajs.com`
- **Password:** `admin`

Use these to authenticate in Swagger UI (`Authorize` button → `bearer <token>` from `POST /api/auth/login`).

The seed is a no-op when `NODE_ENV=production`.

## Environment

| Variable       | Required | Default                  | Purpose                                      |
| -------------- | -------- | ------------------------ | -------------------------------------------- |
| `NODE_ENV`     | no       | `development`            | Disables admin seed when `production`        |
| `HOST`         | yes      | -                        | Bind host for the HTTP server                |
| `PORT`         | yes      | -                        | Bind port                                    |
| `PUBLIC_URL`   | no       | `http://localhost:3030`  | Advertised in OpenAPI `servers[]`            |
| `JWT_SECRET`   | yes      | -                        | HMAC secret for JWT sign/verify              |
| `DATABASE_URL` | yes      | -                        | Postgres connection string                   |
| `CORS_ORIGIN`  | no       | `*`                      | CORS origin (string, comma-list, or `*`)     |

## Endpoints

| Method   | Path                  | Description                         | Auth  |
| -------- | --------------------- | ----------------------------------- | ----- |
| `GET`    | `/`                   | Redirects to the landing page       | -     |
| `GET`    | `/static/*`           | Static files from `public/`         | -     |
| `GET`    | `/api/docs/`          | Swagger UI                          | -     |
| `GET`    | `/api/docs/json`      | OpenAPI 3.1 spec                    | -     |
| `POST`   | `/api/auth/register`  | Create a user + return JWT          | -     |
| `POST`   | `/api/auth/login`     | Exchange credentials for a JWT      | -     |
| `GET`    | `/api/auth/me`        | Current user profile                | JWT   |
| `GET`    | `/api/users`          | Paginated user list                 | JWT   |
| `GET`    | `/api/users/:id`      | Single user                         | JWT   |
| `PATCH`  | `/api/users/:id`      | Update profile (self or admin)      | JWT   |
| `DELETE` | `/api/users/:id`      | Delete user                         | admin |

## Architecture

```
src/
├── app.module.ts           - root module, wires ConfigModule/JwtModule/DrizzleModule/SwaggerModule
├── main.ts                 - bootstrap, global middleware, static files, redirect
├── env.schema.ts           - Zod env contract
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts  - register / login / me
│   ├── auth.service.ts     - argon2 hash + JWT issue
│   ├── guards/
│   │   └── roles.guard.ts  - CanActivate + @Roles() method decorator
│   ├── providers/          - JwtAuth + LocalAuth strategies
│   └── schemas/            - register, login, access-token response
├── users/
│   ├── users.module.ts
│   ├── users.controller.ts - CRUD with Swagger decorators
│   ├── users.service.ts    - Drizzle queries + onReady() admin seed
│   ├── users.policy.ts     - authorization rules for update
│   ├── users.schema.ts     - pgTable definition
│   └── schemas/            - Zod DTOs
├── common/
│   └── middleware/         - requestLogger, responseTime
└── types/
    └── auth.d.ts           - module augmentation for ctx.user
```

## Production

```sh
bun run build
NODE_ENV=production bun run start
```

The admin seed is skipped in production. Create your first admin via `POST /api/auth/register` and then promote the row manually:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

## Further reading

- [MiiaJS source](../..)
- Other examples: [`drizzle-app`](../drizzle-app), [`papr-app`](../papr-app), [`mongoose-app`](../mongoose-app)
