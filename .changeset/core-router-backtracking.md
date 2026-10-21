---
'@miiajs/core': minor
---

The router backs up when a branch leads nowhere, as the routing docs describe: with `/users/:id` and `/users/*`, `GET /users/42/posts/1` reaches the wildcard instead of answering 404, and a static segment that dead-ends falls back to a `:param` route at the same position. Priority is unchanged (static > param > wildcard at each segment), and a URL that matches on the first try costs the same single walk as before. Each route also reads its own parameter names: next to `/users/:id`, `/users/:userId/posts/:postId` gets `{ userId, postId }` instead of `{ id, postId }`.

Breaking: a wildcard now also receives the URLs that more specific routes under it could not finish. A SPA mounted at `/` with `serveStatic(app, '/', dist, { fallback: 'index.html', skipGlobalPrefix: true })` next to an API under `/api` answers an unknown `GET /api/...` with `index.html` (when the client accepts `text/html` or `*/*`) instead of 404. Register a catch-all under the API that throws `NotFoundException` - `app.addRoute('GET', '/*', () => { throw new NotFoundException() }, { skipGlobalGuards: true })` under `globalPrefix: '/api'` - to keep those a 404.
