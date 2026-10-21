---
'@miiajs/core': patch
---

The start-up log lists every route the app serves, not only controller routes: `app.addRoute()`, `serveStatic()` and routes a provider adds from `onReady()` (the `@miiajs/swagger` endpoints) appear too, at the path they are served at. The lines come from the router (context `Router`), and a module configured under a name is logged as `DrizzleModule (name 'analytics') dependencies initialized`.
