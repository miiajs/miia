---
'@miiajs/core': patch
---

A subclass controller that overrides a handler and puts route decorators on the override now replaces the routes and the `body` / `query` / `params` schemas that handler inherited, instead of adding to them. Repeating the parent's route no longer fails at startup with a route conflict, a different schema or a body schema on a handler the parent served with GET no longer throws a `TypeError` when the class is defined, and moving the route to another path no longer leaves the old one served. An override without route decorators keeps the inherited routes and schemas as before. Guards and middleware still add to the parent's, `@Status` and `@BodyLimit` are inherited until the override sets its own, and `@SkipGuard` on the override drops a guard the parent declared.
