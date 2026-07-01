---
'@miiajs/testing': minor
'@miiajs/core': minor
---

Extract `TestApp` into a dedicated `@miiajs/testing` package.

`TestApp` moved out of `@miiajs/core` (the `@miiajs/core/testing` subpath is removed). Import it from `@miiajs/testing` instead. Core gains a public `Miia.provide(...providers)` method for registering providers without a module.
