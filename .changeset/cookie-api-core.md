---
'@miiajs/core': minor
---

Add a cookie API to `@miiajs/core`.

- Fluent writes via `ctx.res.cookie(name, value, options?)` and `ctx.res.deleteCookie(name, options?)` on `ResponseBuilder`. Cookies are appended (multiple `Set-Cookie` headers supported) and mark the response modified so they survive the optimized fast path on node/uws adapters.
- Lazy `ctx.cookies` jar for reading incoming cookies (`get`, `getAll`, `has`) and writing (`set`, `delete`).
- New public helpers `serializeCookie`, `parseCookieHeader`, the `CookieJar` class, and the `CookieOptions` type. Supports `httpOnly`, `secure`, `sameSite`, `maxAge` (seconds), `expires`, `domain`, `path`, `priority`, and `partitioned`, with auto-`Secure` for `SameSite=None` and validation on `name`/`path`/`domain` (header injection), `SameSite=None requires Secure`, and `Partitioned requires Secure`.
