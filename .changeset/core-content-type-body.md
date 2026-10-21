---
'@miiajs/core': patch
---

A handler that sets its own `Content-Type` and returns a value now sends that value. `ctx.res.header('content-type', 'application/vnd.api+json'); return { custom: true }` used to answer 200 with an empty body, because a returned value was serialized only while no `Content-Type` was set; it now goes out as JSON under the handler's `Content-Type` (a returned string is JSON-encoded too - use `ctx.res.text()` or return a `Response` for a raw body). What decides is whether the response already has a body: one set with `ctx.res.json()`, `text()`, `html()` or `stream()` wins over the returned value. With no `Content-Type` set the value goes out as `application/json`, as before, and HEAD responses are unchanged.
