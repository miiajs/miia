---
'@miiajs/core': minor
'@miiajs/testing': minor
---

Typed DI tokens. `createToken<T>(name, { hint? })` makes a token object whose type flows into `inject()`, `injectOptional()`, `app.get()`, `ctx.resolve()` and `Resolver`; an abstract class works as a token too. `provider(token, factory, { scope? })` builds a factory provider checked against the token's type. `hint` on `createToken()` or `@Injectable({ hint })` adds a line to "No provider" errors naming what provides the token, and a second line when another token with the same name and hint is registered (two copies of a package installed). New exports: `createToken`, `provider`, types `Token`, `AbstractConstructor`, `AnyToken`. `TestApp.override()` and `TestApp.resolve()` are typed from the token: `override()` takes a partial mock of the token's type or a function returning one. String tokens keep working for now.
