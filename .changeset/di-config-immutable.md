---
'@miiajs/config': minor
---

Config values are a snapshot taken at startup and frozen. Without a schema `ConfigService` reads a frozen copy of `env`; with a schema the parsed result is copied and its plain objects and arrays are frozen, so `config.get('ORIGINS').push(...)` no longer changes the value every other caller sees. `Map`, `Set`, `Date` and class instances a `transform` returns are kept as they are, and the passed `env` and `process.env` are never frozen. The options factory of `ConfigModule.configure((resolve) => ...)` still runs once. `ConfigService` keeps the values in a private `#config` field instead of a TypeScript-only `private config`. Breaking:

- without a schema `ConfigService` no longer reads the live `process.env` - a change to `process.env` (or to the passed `env`) after startup is not seen; set it before `init()`, pass `env`, or override `ConfigModule` in tests
- values from a schema are frozen - writing to an object or array value throws `TypeError` in ESM; copy it before handing it to an API that mutates its input
- on Deno a config without a schema reads the whole environment at startup, so it needs `--allow-env` without a list of names
