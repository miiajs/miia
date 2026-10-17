---
'@miiajs/serve-static': patch
---

A 404 from the static handler reads like the router's own: `Cannot GET /static/missing.txt`. It used to carry the absolute request URL, including whatever `Host` header the client sent, and always said `GET`, also for `HEAD`.
