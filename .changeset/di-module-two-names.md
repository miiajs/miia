---
'@miiajs/core': patch
---

A module class with its own `@Module` providers, controllers or imports can be configured under several names. Each of its providers is one instance shared by every name, and what it injects - `inject()`, a factory's `resolve()` and `deps`, and the `Resolver` it gets, which covers every name - is checked against module boundaries from each of them. Its controllers are mounted once, with their guards checked from every name, and a `configure()` result in its `imports` is imported once.
