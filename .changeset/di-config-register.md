---
'@miiajs/config': minor
---

Feature configs. `defineConfig(name, schema)` returns a typed token (type `ConfigToken<T>`) for the variables a feature module owns, and `ConfigModule.register(token)` provides it in that module: `inject(paymentsConfig)` gets the schema's output, validated at startup and frozen like the root values. The schema reads the same env as the root `ConfigModule.configure()` (its `env`, or `process.env`), and `process.env` in an app without one. Several modules may register the same token and share one instance, validated once. A validation error names the config: `[Miia] Config validation failed for 'payments':`. In tests the token is replaced like any provider: `TestApp.override(paymentsConfig, { STRIPE_KEY: 'test' })`. The module that imports `register()` must see the root config - make it global or import `ConfigModule` there - or startup fails with a module boundary violation.
