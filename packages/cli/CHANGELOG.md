# @miiajs/cli

## 0.9.0

### Minor Changes

- [`c1bc80d`](https://github.com/miiajs/miia/commit/c1bc80dfd2338668ba32c60fd8021d6f5a477dd8) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `miia add <feature...>` applies add-ons to an existing project through the same code as `miia new --features/--db`: jwt-auth (working register/login/me, `Bun.password` on Bun and scrypt elsewhere), swagger, cors, serve-static, rate-limit, biome, drizzle-postgres, drizzle-mysql, drizzle-sqlite (Bun and Node.js), papr and mongoose. Infrastructure modules are `{ global: true }`, `AuthModule` is global with `exports: [JwtAuth]`. Installed add-ons are skipped, a second database is refused, a dirty git tree asks first, `--dry-run` prints the changes, and files a codemod cannot edit get a warning instead of a guess. Third-party versions in the templates are checked against the peer ranges of the packages.

  jwt-auth also registers `UsersModule` in the root module, before `AuthModule`, keeps its zod schemas in `src/auth/schemas/` (one file per schema with its `z.infer` type) the `User` / `StoredUser` types in `src/users/users.types.ts`, and hashes passwords through an injectable `PasswordService`. A database add-on adds a `## Database` section to README.md (the connection URL, a `docker run` line for PostgreSQL, MySQL or MongoDB, and for Drizzle how to add a table with `miia g table`, `db:generate` / `db:migrate` and a query through the typed `db` handle) and prints the next steps, with the project's package manager: `miia new` before `run dev`, `miia add` after `Added ...`.

  The Drizzle add-ons write `src/db.ts`, the typed handle, and `src/db.schema.ts`, an empty barrel of tables that `miia g table` fills; they create no table themselves, and `src/db.migrate.ts` runs the migrations of sqlite on Bun.

  jwt-auth keeps users in the project's database: a `users` table with UUID ids on Drizzle (`src/users/users.table.ts` for the dialect in `drizzle.config.ts`, added to the schema file, with `db:generate` and `db:migrate` in the next steps and in the README), `src/users/users.model.ts` on papr and mongoose (the native ObjectId `_id`, `User.id` is its string, a unique index on `email`). Without a database users stay in memory with UUID ids. Database add-ons run first whatever the order of the ids, and the generated auth test replaces `UsersService` with a fake, so it needs no database. A database added later to a project with in-memory users warns that `src/users/users.service.ts` keeps them in memory and leaves that file alone; a `drizzle.config.ts` the add-on cannot read keeps users in memory with a warning.

- [`5e3af4c`](https://github.com/miiajs/miia/commit/5e3af4c7ab3651d6ec597ed8e275dede12a4c9d5) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `typescript` is a peer dependency of the CLI: module registration in `miia g` edits files through the TypeScript compiler API and keeps the rest of the file byte for byte (EOL, indent, comments), recognizes `forwardRef(() => X)`, `X.configure(...)`, shorthand and quoted keys, and warns instead of guessing on arrays held in variables or spreads. Registration errors are no longer swallowed, and `--dry-run` prints the same set of changes that a real run writes.

  Breaking: `typescript` (`^6.0.0`) must be installed next to `@miiajs/cli` - projects from `miia new` already have it.

- [`5e3af4c`](https://github.com/miiajs/miia/commit/5e3af4c7ab3651d6ec597ed8e275dede12a4c9d5) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `miia --version`; runtime detection reads `deno.json` and lockfiles in parent directories, so a Deno project installed with pnpm runs on Deno; `miia start` returns the app's exit code and forwards termination signals without cutting a graceful shutdown short; `miia dev` keeps a `NODE_ENV` you set, no longer restarts the watcher and keeps serving when type-checking stops; `dev`, `start` and `build` name the runtime only when it was detected, not given with `--runtime`, and `dev` prints the result of type-checking without progress lines; executables are found without `which`, including `.cmd`/`.exe` shims on Windows.

- [`c1bc80d`](https://github.com/miiajs/miia/commit/c1bc80dfd2338668ba32c60fd8021d6f5a477dd8) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `miia g` works on template files: `g resource` generates a working CRUD module (route schemas, `@Status(201)` / `@Status(204)`, `NotFoundException`, an in-memory service, a test through `TestApp`) whose module exports its service; `g service --export` also adds the service to `exports`; `g guard` no longer registers the guard in a module, since a guard nobody declares works from any module; `g table` writes a Drizzle table. Names are validated and acronyms split (`HTTPServer` -> `http-server.service.ts`). A resource keeps each zod schema in its own file under `schemas/` with its `z.infer` type (`schemas/create-posts.schema.ts`) and the entity interface in `posts.types.ts`, without barrel files. `g guard` and `g middleware` write to `src/common/guards/` and `src/common/middleware/`, or straight into the folder the name or `--path` gives (`g guard admin --path users` -> `src/users/admin.guard.ts`); they never get a folder of their own, with or without `--flat`.

  A resource has UUID ids: `crypto.randomUUID()` in the service and `z.uuid()` in the id params schema, so a malformed id answers 422 and a well-formed unknown one 404.

  `miia g table <name>` reads the dialect and the schema file from `drizzle.config.ts`, writes `<name>.table.ts` for postgres, mysql or sqlite (a UUID `id`, `name`, `createdAt`, `updatedAt`, the `<Name>` and `New<Name>` types, SQL name in snake_case), adds `export *` to the schema file and prints `db:generate` / `db:migrate`, also under `--dry-run`. It is placed like a service. Without a `drizzle.config.ts` or with another dialect it stops; a `schema` that is an array, a glob or a path outside the project gets a warning to add the table by hand; a reserved word or a name the table file imports is refused.

  Breaking: a resource's `id` is a UUID string instead of a number, a name with a dot or other characters outside letters, digits, `-` and `_` is an error, `g guard` leaves the parent module alone, and `g guard` / `g middleware` no longer create a `<name>/` folder (`src/admin/admin.guard.ts` is now `src/common/guards/admin.guard.ts`).

- [`c1bc80d`](https://github.com/miiajs/miia/commit/c1bc80dfd2338668ba32c60fd8021d6f5a477dd8) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `miia new` is rebuilt on template files shipped with the CLI: a base project plus a runtime layer (Bun first, Node.js and Deno), ready for strict module boundaries. `@miiajs/*` versions follow the CLI version (`^` of it), config is always included (global `ConfigModule`, `src/env.schema.ts`, `.env` and `.env.example`), tests sit next to the code on `bun:test` (`node:test` + `expect` on Node.js and Deno), and scripts pin `--runtime`. Every prompt has a flag (`--runtime`, `--pm`, `--features`, `--db`), `-y` and runs without a TTY take the defaults, and the folder must be new or empty.

  Breaking: the generated project has a different layout, and features move to add-ons.

### Patch Changes

- [`ddd7230`](https://github.com/miiajs/miia/commit/ddd723055dc728063cee606eeb30358028b17ca6) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - `JWT_SECRET` is empty in `.env.example` (a copied example no longer starts with a publicly known secret) and `NODE_ENV` is gone from it, so `bun run start` runs in production; scrypt passwords on Node.js and Deno use N=2^17 with the parameters stored in the hash; a Deno project gets a `miia` task, so `deno task miia ...` runs the project's CLI version. `miia dev` puts the watcher in its own process group on POSIX, so stopping it also stops the app under `node --watch`; `start` and `dev` exit with the app's code, or `128 + signal` when a signal ended the app. `miia build --runtime node` refuses a config with `noEmit` instead of reporting a build with no output. Warnings print before the install, formatters skip files they do not know (`.env`, `.gitignore`), and writes are staged, so a failed write leaves the project as it was. Codemods: an aliased import no longer counts as the name itself, specifiers with and without `.js` are one module (new imports follow the file's style), comments survive when a one-line array becomes multi-line, and `miia g` prefers the module `main.ts` registers when a folder has several.

## 0.8.0

### Patch Changes

- [`9f4eb66`](https://github.com/miiajs/miia/commit/9f4eb6681c7b746d719794c1f76b2dd166a5652a) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Name the scaffolded auth files after providers

  `miia new` with JWT Auth generated `src/auth/strategies/jwt.strategy.ts` and `local.strategy.ts`, a leftover from the
  strategy-based API - the classes inside were already `AuthProvider`s. It now writes
  `src/auth/providers/jwt-auth.provider.ts` and `src/auth/providers/local-auth.provider.ts`, the names the docs and the
  full-app example use.

- [`36d1f60`](https://github.com/miiajs/miia/commit/36d1f6056e2e19e7fec5d26c25ebc7a43693bdc9) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Lower the runtime floors to what the packages need.

  Node moves from `24.18.1` to `22.12.0`. Nothing in the packages needs Node 24. 22.12.0 is the first
  22.x release where `require(esm)` is on by default, so CommonJS code can `require()` these ESM-only
  packages, and it is the floor `papr@17` declares. The old floor tracked the 24.17.0 and 24.18.1
  security releases; `engines` cannot enforce a patch level, so that advice now lives in `SECURITY.md`.

  Deno moves from `2.6.1` to `2.0.0`, with two exceptions. Projects that `@miiajs/cli` runs on Deno
  need 2.4.0, the first release with the `--sloppy-imports` flag the CLI passes. `@miiajs/serve-static`
  needs 2.5.0: on 2.0 through 2.4 Deno's `Readable.toWeb` throws an uncaught error once a file has been
  sent and takes the process down.

  `@miiajs/uws-server` now declares Node.js 22, 24 and 26 only, with no Bun or Deno range:
  uWebSockets.js ships binaries for those three lines and never loaded anywhere else.
  `@miiajs/node-server` drops its Deno range: Deno apps listen through `Deno.serve` and never need the
  adapter, and it is not tested there.

  Bun stays at `1.4.0`.

  The documented TypeScript requirement moves from 5.7 to 6.0. The `ES2025` target that the docs and
  `miia new` use does not exist before TypeScript 6.0, so 5.7 through 5.9 never worked with that setup.

## 0.7.0

## 0.6.1

## 0.6.0

### Minor Changes

- [`fafb103`](https://github.com/miiajs/miia/commit/fafb1036bb5e7658fd7971d380e321c0e080798e) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Raise the Bun floor from `1.3.11` to `1.4.0`.

  Bun 1.4 makes `Bun.serve` pause a `ReadableStream` request body when the consumer stops draining it, so
  a stalled handler now holds the client back instead of letting the runtime buffer the upload. That is
  what the streaming contract in `@miiajs/multipart` describes, and on 1.3 it was only true of Deno and
  `@miiajs/node-server`.

  Two further behaviours were measured as fixed on 1.4.0 but are not part of Bun's published release
  notes, so treat them as observations rather than guarantees: `maxRequestBodySize` now also rejects a
  body sent without a `Content-Length`, and a connection survives a response written before the request
  body was drained - on 1.3 the next request on that connection came back as an empty `400`.

  The `Readable.fromWeb` workaround the multipart docs carried is gone with the floor: on 1.3.12 it never
  settled once the web stream errored, and on 1.4.0 it rejects like Node does.

- [`44f697d`](https://github.com/miiajs/miia/commit/44f697dd16deaf58c8af37269405ac961967c76f) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Raise the Node floor from `22.22.1` to `24.18.1`.

  The floor lands on that release rather than on `24.0.0` because 24.17.0 and 24.18.1 were both security
  releases, and what they fix is what a framework that is itself an HTTP server runs on: hostname
  normalization for TLS server identity checks, two high-severity http2 fixes covering header memory
  retention in session accounting and a deferred rst stream, response queue poisoning in `http.Agent`,
  and a refusal for requests that exceed the maximum header count. 24.18.1 also carries llhttp 9.4.3 and
  undici 7.29.0.

  The 24 line itself marks `require(esm)` and the module compile cache stable and raises the default
  `Buffer.poolSize` to 64 KiB.

  `@miiajs/uws-server` is unaffected by the move: uWebSockets.js 20.69.0 ships a `137` binary, so Node 24
  already loaded it.

  Types stay on `@types/node@^24.13.3`, which is where DefinitelyTyped ended the 24 line. The APIs added
  in 24.16 through 24.19 - `req.signal` on `IncomingMessage`, the `httpValidation` server option,
  `blob.textStream()` - are there at runtime but carry no type definitions yet.

## 0.5.0

## 0.4.0

## 0.3.0

## 0.2.0

### Patch Changes

- Version bump only - fixed versioning across the @miiajs/\* group.

## 0.1.1

### Patch Changes

- [`766e8a0`](https://github.com/miiajs/miia/commit/766e8a03510713f2a7948c9f4048ea1905b325ee) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Normalize the `miia` bin path in `package.json` (`./dist/bin.js` → `dist/bin.js`) to avoid issues with package managers that do not accept the leading `./` in `bin` entries.

## 0.1.0
