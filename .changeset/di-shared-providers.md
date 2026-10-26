---
'@miiajs/core': minor
'@miiajs/papr': minor
'@miiajs/mongoose': minor
---

Shared providers. `provider(token, factory, { shared: key })` lets several modules declare the same token, each with a provider marked by the same key, and get one instance: the first declaration builds it, every declaring module owns it and may export it, and what its factory injects is checked against module boundaries from each of them, whatever the order of `imports`. Its `inject(Resolver)` / `resolve(Resolver)` gets one resolver over all of them: `has()` is `true` only for a token every one of them sees, and `resolve()` reports a violation from each one that cannot see it. A different key throws `[Miia] X is shared by A (k1) and B (k2) - a shared provider must be declared the same way in every module; use a separate token for each variant`; an unmarked declaration next to a marked one is still `provided by both`. papr and mongoose `register()` mark their models with the connection (`the default connection`, `connection 'analytics'` - the unnamed connection and one named `'default'` are two connections), so several feature modules can `register([User])` and share one model instead of failing with `provided by both` - each of them must see `PaprModule` / `MongooseModule` itself. Breaking:

- the same model token registered on two connections (`register([User])` and `register([User], { name: 'analytics' })`) throws at startup (`... (the default connection) and ... (connection 'analytics')`) instead of logging a `console.warn` - the warning was process-wide, the check is now per app; use a separate `defineModel(...)` per connection
