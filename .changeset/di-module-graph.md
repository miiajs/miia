---
'@miiajs/core': minor
---

New `forwardRef(() => X)` (type `ForwardRef`) for module files that import each other: written on both sides of the cycle, in `imports` or `exports`, it defers the reference until the graph loads. New module options `exports` and `global` on `@Module()` and on `ConfiguredModule` - the loader records them and checks `exports`, and module boundaries are checked against them. Breaking:

- `exports` may list only the module's own providers and modules it imports: `[Miia] UsersModule exports MailService, which it neither provides nor imports`
- one `configure()` result imported by two modules (or by a module and `register()`) throws `[Miia] The same configured module X is imported by A and B` instead of being shared - import it once and re-export it, or make it global
- the same provider in two modules throws `[Miia] MailService is provided by both UsersModule and OrdersModule` (configured modules are named with their host), and a provider listed twice in one module throws `[Miia] MailService is listed twice in UsersModule providers` - both replace `Duplicate provider: X is already registered`
- `provide()` of a token a loaded module declares throws `[Miia] provide(X): X is declared by XModule - replace it with override() instead` instead of the module declaration being skipped
- a module override inherits `global` from the configuration it replaces; a replacement that sets a different `global` throws
- an `undefined` in `imports` / `exports`, or a `forwardRef()` that returns something other than a module, throws with the `forwardRef` advice
