---
'@miiajs/core': minor
---

Answer malformed JSON with 400 everywhere and read an empty body as no body

`ctx.json()` now reads the body through `ctx.text()` and parses it itself. A non-empty body that is not valid JSON
rejects with `BadRequestException` (400, `Malformed JSON body`) on every route. Before, a route without a schema
answered 500 and a route with a `body` schema answered 422 (`Body validation failed`); the schema no longer runs on
such a body.

An empty body, or none at all (a GET, a HEAD), makes `ctx.json()` resolve to `undefined` instead of rejecting with a
`SyntaxError` that ended in a 500. On a route with a `body` schema the schema gets `undefined`, so a required object
answers 422. Code that relied on `ctx.json().catch(() => fallback)` for an empty body now gets `undefined` rather than
the fallback; use `(await ctx.json()) ?? fallback` instead.

`ctx.json()` and `ctx.text()` share one read of the body, so they can be called in any order on the same request on
every runtime. Before, the second call threw `body already used` on Bun, Deno and streaming bodies. After a `body`
schema runs, `ctx.json()` returns the validated data while `ctx.text()` returns the raw text. The raw stream
(`ctx.req.body`, `ctx.req.formData()`, `ctx.req.arrayBuffer()`) is still available only before the first call to
either helper.
