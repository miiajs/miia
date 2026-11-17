---
'@miiajs/core': minor
'@miiajs/mongoose': minor
'@miiajs/papr': minor
'@miiajs/config': minor
'@miiajs/drizzle': patch
'@miiajs/messaging': patch
'@miiajs/testing': patch
---

A token's `name` is the name it was given, and a new `kind` says what the token is. `createToken<T>(name, { kind?, hint? })` takes it, and messages show a token with a kind as `kind(name)`: `MongooseModel(User)`, `PaprModel(users)`, `Config(payments)`, `mongooseConnection(analytics)`, `MessageBus(kafka)`. `formatToken(token)` is exported from `@miiajs/core` and returns that label; a class prints its own name. `defineModel('User', schema).name` is now `'User'`, so it can go straight to mongoose, as in `ref: User.name`. Breaking:

- `User.modelName` (mongoose) is now `User.name`, `collectionName` (papr) is `name` and `configName` (`defineConfig()`) is `name`; the `__miiaMongooseModel` and `__miiaPaprModel` fields are gone
- `name` no longer holds the label: `defineModel('User', schema).name` was `'MongooseModel(User)'`, and `formatToken(User)` returns it now
- unnamed tokens are labelled `X()` instead of `X(default)`, and their `name` is `''`: `drizzleDb()`, `paprDb()`, `mongooseConnection()`, and in errors the internal ones such as `MongooseService()` or `MessagingOptions()`
