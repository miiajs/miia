---
'@miiajs/core': minor
---

Enforce the per-route body limit on requests that declare no `Content-Length`.

Until now `@BodyLimit` and `maxBodySize` only ever met the declared length. A chunked body has none,
so the sole bound on it was the adapter's ceiling - `max(maxBodySize, every @BodyLimit in the app)`.
A route declaring `@BodyLimit(4096)` accepted a 900 KB chunked body, and a single generous upload
route raised what every other route would swallow.

`checkBodyLimit()` now also narrows the adapter's `_bodyLimit` slot to the matched route's limit,
which is possible because routing has already happened by then. The write uses `Math.min`, so an
adapter given a stricter cap of its own - `serve({ maxBodySize })` used standalone - keeps it. The
existing `Content-Length` check is untouched, and the same single header read serves both, so
nothing is added to the hot path.

`@miiajs/node-server` owns that slot and applies it when the body is first materialized, so its
chunked bodies are now counted against the route's own limit. Runtimes whose request is a real
`Request` have no slot and keep the ceiling: Bun, Deno, both adapters in `mode: 'native'`, and
anything reached through `app.fetch`, including `TestApp`. `@miiajs/uws-server` will follow.

Two things worth knowing. Enforcement happens when the body is read - a handler that returns without
touching a chunked body lets the client upload up to the ceiling regardless. And a malformed
`Content-Length`, which cannot be judged on its face, is now counted as it arrives rather than
falling through to the ceiling.
