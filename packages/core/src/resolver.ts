import type { Container, ResolverView } from './di-container.js'
import type { AbstractConstructor, AnyToken, Token } from './types.js'

/**
 * Public DI lookup API. Wraps `Container` with a narrowed surface: only the
 * read operations user code legitimately needs (`has`, `resolve`,
 * `resolveOptional`). Mutations (`register`, `destroyAll`) stay internal -
 * `Container` itself is not registered as a public DI token.
 *
 * **Prefer `inject(Token)` over `resolver.resolve(Token)` when possible.**
 * Field-init `inject()` is the idiomatic MiiaJS pattern - it composes with
 * lifecycle hooks and keeps deps explicit at the class level. Reach for
 * `Resolver` only for runtime inspection: plugin systems, conditional
 * resolution, or when the token is not known until runtime.
 *
 * `inject(Resolver)` returns a resolver bound to the module of the provider
 * that injects it, and it sees what that module sees: `has()` is `false` for a
 * token the module cannot see, `resolve()` and `resolveOptional()` of one are a
 * module boundary violation (`resolveOptional()` returns `null` only for a
 * token nothing registers). A provider several modules declare (a shared
 * provider, a provider of a module class configured under several names) gets
 * a resolver over all of them: `has()` is `true` only for a token every one of
 * them sees, and `resolve()` is checked from each. A provider without a module,
 * a guard no module declares and `app.get(Resolver)` get the resolver of the root.
 *
 * `resolve()` of a request-scoped token throws - there is no request to keep the
 * instance on. Use `ctx.resolve()` in a handler, middleware or guard instead.
 *
 * @example
 * ```ts
 * const PLUGINS: Record<string, Token<Plugin>> = {
 *   csv: createToken<Plugin>('CsvPlugin'),
 *   pdf: createToken<Plugin>('PdfPlugin'),
 * }
 *
 * @Injectable()
 * class PluginRegistry {
 *   private resolver = inject(Resolver)
 *
 *   load(name: string): Plugin {
 *     const token = PLUGINS[name]
 *     if (!token || !this.resolver.has(token)) throw new Error(`unknown plugin: ${name}`)
 *     return this.resolver.resolve(token)
 *   }
 * }
 * ```
 */
export class Resolver {
  /** @internal */
  constructor(
    private container: Container,
    private view: ResolverView,
  ) {}

  has(token: AnyToken): boolean {
    return this.container.visible(this.view, token)
  }

  resolve<T>(token: Token<T> | AbstractConstructor<T>): T {
    return this.container.resolveFrom(this.view, token, false) as T
  }

  resolveOptional<T>(token: Token<T> | AbstractConstructor<T>): T | null {
    return this.container.resolveFrom(this.view, token, true) as T | null
  }
}
