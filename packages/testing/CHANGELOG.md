# @miiajs/testing

## 0.4.0

### Minor Changes

- [`ef51172`](https://github.com/miiajs/miia/commit/ef511723538e332ca365c47593f4e6e76351b2e2) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Extract `TestApp` into a dedicated `@miiajs/testing` package.

  `TestApp` moved out of `@miiajs/core` (the `@miiajs/core/testing` subpath is removed). Import it from `@miiajs/testing` instead. Core gains a public `Miia.provide(...providers)` method for registering providers without a module.
