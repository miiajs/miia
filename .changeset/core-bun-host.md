---
'@miiajs/core': patch
---

On Bun a request whose `Host` header is not a plain host (`x/y`, `x?q`, empty) reaches `app.fetch` with a relative `req.url`, and the router dropped the first segment of its path: `GET /foo/admin/x` was routed to `/admin/x`. Such a request is now routed by its whole path.
