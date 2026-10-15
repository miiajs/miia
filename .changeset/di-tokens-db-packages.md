---
'@miiajs/drizzle': minor
'@miiajs/papr': minor
'@miiajs/mongoose': minor
---

DB tokens are typed `createToken()` objects, and a named connection is the same module class with a `name`. "No provider" errors name the call that provides a token: `drizzleDb(analytics) is provided by DrizzleModule.configure(opts, { name: 'analytics' })`, likewise for `paprDb()`, `mongooseConnection()` and model tokens. Configuring one name twice now throws `configured twice`, and a named connection can be replaced in tests with `TestApp.override(DrizzleModule, DrizzleModule.configure(test, { name: 'analytics' }))`. Breaking:

- `drizzleDb()`, `paprDb()`, `mongooseConnection()` and `defineModel()` return frozen `Token` objects instead of classes; `DrizzleDbToken`, `PaprDbToken`, `MongooseConnectionToken` and `ModelToken` changed shape accordingly. A model token is not a class: `new User(data)` and `doc instanceof User` throw a `TypeError` - use the injected model (`new this.users(data)`, `doc instanceof this.users`)
- the connection name moved into an options object: `configure(opts, { name: 'analytics' })` and `register(models, { name: 'analytics' })` instead of `configure(opts, 'analytics')` and `register(models, 'analytics')`
- a named `configure()` returns `{ module: XModule, name }` instead of a new anonymous module class per call
