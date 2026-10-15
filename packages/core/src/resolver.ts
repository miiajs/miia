import type { Container } from './di-container.js'
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
  constructor(private container: Container) {}

  has(token: AnyToken): boolean {
    return this.container.has(token)
  }

  resolve<T>(token: Token<T> | AbstractConstructor<T>): T {
    return this.container.resolve<T>(token)
  }

  resolveOptional<T>(token: Token<T> | AbstractConstructor<T>): T | null {
    return this.container.resolveOptional<T>(token)
  }
}
