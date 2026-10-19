---
'@miiajs/core': patch
---

A module class with its own `@Module` providers, controllers or imports can be configured under several names: each of its providers is one instance shared by every name and checked against module boundaries from each of them, its controllers are mounted once, and a `configure()` result in its `imports` is imported once - instead of a duplicate provider, a duplicate route or an R8 error.
