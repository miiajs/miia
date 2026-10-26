---
'@miiajs/cli': minor
---

`miia g` works on template files: `g resource` generates a working CRUD module (route schemas, `@Status(201)` / `@Status(204)`, `NotFoundException`, an in-memory service, a test through `TestApp`) whose module exports its service; `g service --export` also adds the service to `exports`; `g guard` no longer registers the guard in a module, since a guard nobody declares works from any module. Names are validated and acronyms split (`HTTPServer` -> `http-server.service.ts`).

Breaking: a name with a dot or other characters outside letters, digits, `-` and `_` is an error, and `g guard` leaves the parent module alone.
