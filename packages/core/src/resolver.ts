import type { Container } from './di-container.js'
import type { Constructor } from './types.js'

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
 * @example
 * ```ts
 * @Injectable()
 * class PluginRegistry {
 *   private resolver = inject(Resolver)
 *
 *   load(name: string) {
 *     const token = `plugin:${name}`
 *     if (!this.resolver.has(token)) throw new Error(`unknown plugin: ${name}`)
 *     return this.resolver.resolve(token)
 *   }
 * }
 * ```
 */
export class Resolver {
  constructor(private container: Container) {}

  has(token: Constructor | string): boolean {
    return this.container.has(token)
  }

  resolve<T>(token: Constructor<T> | string): T {
    return this.container.resolve<T>(token)
  }

  resolveOptional<T>(token: Constructor<T> | string): T | null {
    return this.container.resolveOptional<T>(token)
  }
}
