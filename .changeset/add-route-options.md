---
'@miiajs/core': minor
---

**Breaking: the fourth argument of `app.addRoute()` changed type.** It was `middlewares:
Middleware[] = []`; it is now `options: AddRouteOptions = {}`:

```ts
// before
app.addRoute('POST', '/upload', handler, [authMiddleware])

// after
app.addRoute('POST', '/upload', handler, { middlewares: [authMiddleware] })
```

Three-argument calls are unaffected. Every four-argument call has to wrap its array as
`{ middlewares: [...] }` - the array position is gone, not deprecated. TypeScript rejects the old
form; at runtime an array destructures to no `middlewares`, so the route would silently lose them.

**One argument shape, not two.** The object is what carries the rest of a route's options -
`skipGlobalGuards`, `bodyLimit`, and the `skipGlobalPrefix` flag that lands with the global prefix.
Keeping the array as a second accepted shape would mean every new flag has a call form it cannot be
expressed in, and `app.addRoute()` would keep drifting from `Router.add()`, which has taken this
object all along. `AddRouteOptions` is now exported from `@miiajs/core`.
