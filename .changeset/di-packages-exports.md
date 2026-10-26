---
'@miiajs/config': minor
'@miiajs/jwt': minor
'@miiajs/rate-limit': minor
'@miiajs/swagger': minor
'@miiajs/drizzle': minor
'@miiajs/papr': minor
'@miiajs/mongoose': minor
'@miiajs/messaging': minor
---

`configure()` takes `{ global: true }` in its second argument (`{ name?, global? }` for drizzle, papr, mongoose and messaging) and declares its `exports`, which decide what other modules see of it:

- `ConfigModule`, `JwtModule` and `SwaggerModule` export `ConfigService`, `JwtService` and `SwaggerService`; `RateLimitModule` exports the options its guards read
- `DrizzleModule`, `PaprModule` and `MongooseModule` export the db / connection token, papr and mongoose also the internals their `register()` models resolve; `MessagingModule` exports its bus
- papr and mongoose `register()` exports its models, and its module is named `PaprModule.register([users])` / `MongooseModule.register([User])` in errors and the start-up log

Breaking: messaging checks the `bus` of every `@On` against the `MessageBus` instances of the app instead of the container. A bus token overridden with a plain object no longer counts as a bus, so an `@On` that targets it fails at startup - replace the bus through its configuration, or override the token with a factory that builds a `MessageBus` (or a subclass) under the same name.
