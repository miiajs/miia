# @miiajs/cli

CLI for [MiiaJS](https://miiajs.com): create projects, add features, generate code, and run them on Bun, Node.js and Deno.

## Create a project

```bash
bun create miia my-app
npm create miia@latest my-app
deno run -A npm:create-miia my-app
```

The generated project has `@miiajs/cli` as a devDependency; its scripts call `miia`.

## Commands

| Command | What it does |
| --- | --- |
| `miia new [name]` | New project from the templates (`--runtime`, `--pm`, `--features`, `--db`, `-y`) |
| `miia add <add-on...>` | Add jwt-auth, swagger, cors, serve-static, rate-limit, biome, drizzle-postgres, drizzle-mysql, drizzle-sqlite, papr or mongoose to a project |
| `miia g <schematic> <name>` | Generate a module, controller, service, guard, middleware, CRUD resource or Drizzle table |
| `miia dev` | Runtime watcher + `tsc --watch` |
| `miia build` | Type-check (Bun, Deno) or compile to `dist/` (Node.js) |
| `miia start` | Production start, forwarding signals and the exit code |
| `miia check` | `tsc --noEmit` |

`typescript` 6 is a peer dependency.

## Documentation

**[miiajs.com/docs/packages/cli](https://miiajs.com/docs/packages/cli)**

## License

MIT
