---
'@miiajs/cli': minor
---

`miia new` is rebuilt on template files shipped with the CLI: a base project plus a runtime layer (Bun first, Node.js and Deno), ready for strict module boundaries. `@miiajs/*` versions follow the CLI version (`^` of it), config is always included (global `ConfigModule`, `src/env.schema.ts`, `.env` and `.env.example`), tests sit next to the code on `bun:test` (`node:test` + `expect` on Node.js and Deno), and scripts pin `--runtime`. Every prompt has a flag (`--runtime`, `--pm`, `--features`, `--db`), `-y` and runs without a TTY take the defaults, and the folder must be new or empty.

Breaking: the generated project has a different layout, and features move to add-ons
