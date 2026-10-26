---
'@miiajs/core': minor
'@miiajs/testing': minor
---

Typed DI tokens. `createToken<T>(name, { hint? })` makes a token object whose type flows into `inject()`, `injectOptional()`, `app.get()`, `ctx.resolve()` and `Resolver`; an abstract class works as a token too. `provider(token, factory, { scope?, deps?, shared? })` builds a factory provider checked against the token's type. `hint` on `createToken()` or `@Injectable({ hint })` adds a line to "No provider" errors naming what provides the token, and a second line when another token with the same name and hint is registered - the token is defined twice on purpose (two `defineModel('User', ...)` calls, one per connection) or a package is installed twice: `register this one too if both are intended, otherwise deduplicate the package that defines it`. New exports: `createToken`, `provider`, types `Token`, `AbstractConstructor`, `AnyToken`. `TestApp.override()` and `TestApp.resolve()` are typed from the token: `override()` takes a partial mock of the token's type or a function returning one.
