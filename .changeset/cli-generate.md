---
'@miiajs/cli': minor
---

`miia g` works on template files: `g resource` generates a working CRUD module (route schemas, `@Status(201)` / `@Status(204)`, `NotFoundException`, an in-memory service, a test through `TestApp`) whose module exports its service; `g service --export` also adds the service to `exports`; `g guard` no longer registers the guard in a module, since a guard nobody declares works from any module; `g table` writes a Drizzle table. Names are validated and acronyms split (`HTTPServer` -> `http-server.service.ts`). A resource keeps each zod schema in its own file under `schemas/` with its `z.infer` type (`schemas/create-posts.schema.ts`) and the entity interface in `posts.types.ts`, without barrel files. `g guard` and `g middleware` write to `src/common/guards/` and `src/common/middleware/`, or straight into the folder the name or `--path` gives (`g guard admin --path users` -> `src/users/admin.guard.ts`); they never get a folder of their own, with or without `--flat`.

A resource has UUID ids: `crypto.randomUUID()` in the service and `z.uuid()` in the id params schema, so a malformed id answers 422 and a well-formed unknown one 404.

`miia g table <name>` reads the dialect and the schema file from `drizzle.config.ts`, writes `<name>.table.ts` for postgres, mysql or sqlite (a UUID `id`, `name`, `createdAt`, `updatedAt`, the `<Name>` and `New<Name>` types, SQL name in snake_case), adds `export *` to the schema file and prints `db:generate` / `db:migrate`, also under `--dry-run`. It is placed like a service. Without a `drizzle.config.ts` or with another dialect it stops; a `schema` that is an array, a glob or a path outside the project gets a warning to add the table by hand; a reserved word or a name the table file imports is refused.

Breaking: a resource's `id` is a UUID string instead of a number, a name with a dot or other characters outside letters, digits, `-` and `_` is an error, `g guard` leaves the parent module alone, and `g guard` / `g middleware` no longer create a `<name>/` folder (`src/admin/admin.guard.ts` is now `src/common/guards/admin.guard.ts`).
