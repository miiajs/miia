---
'@miiajs/drizzle': minor
---

`dialect: 'sqlite'` uses the built-in `bun:sqlite` on Bun and `better-sqlite3` elsewhere; `connection.driver` picks the driver explicitly. The `better-sqlite3` peer range accepts 12.x. On Deno, where `better-sqlite3` crashes the process, the dialect fails with an error unless `connection.driver` is set
