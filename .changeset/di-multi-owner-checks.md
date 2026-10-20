---
'@miiajs/core': patch
'@miiajs/papr': patch
'@miiajs/mongoose': patch
---

Entries with several owning modules - a shared provider, a provider or controller of a module class configured under several names - are checked from each of them in two more places, so the result no longer depends on the order of `imports`: the guards of such a controller, and `inject(Resolver)` / a factory's `resolve(Resolver)`, which returns a resolver over all owners (`has()` is `true` only for a token every one of them sees, `resolve()` reports a violation from each one that cannot see it). `destroy()` waits only for the request `onDestroy()` hooks of requests that finished before it started - also when `destroyAll()` runs in the same tick as the end of a request - so requests that keep coming in through `app.fetch` no longer hold it up, and concurrent `destroy()` calls share one shutdown instead of running the hooks twice. The papr / mongoose shared key of a model no longer confuses the unnamed connection with one named `'default'`: `register([User])` and `register([User], { name: 'default' })` throw `... (the default connection) and ... (connection 'default')` instead of silently sharing one model.
