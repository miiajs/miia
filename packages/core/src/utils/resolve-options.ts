import type { Resolve } from '../types.js'

/**
 * Union accepted by every `*.configure()` in `@miiajs/*`: either a static options
 * object or a factory that receives the DI resolver. Use together with
 * `resolveOptions()` inside the provider factory.
 *
 * @example
 * ```ts
 * static configure(optionsOrFactory: OptionsOrFactory<JwtOptions>): ConfiguredModule {
 *   return {
 *     module: JwtModule,
 *     providers: [
 *       {
 *         token: JWT_OPTIONS,
 *         factory: (container) => resolveOptions(optionsOrFactory, container),
 *       },
 *     ],
 *   }
 * }
 * ```
 */
export type OptionsOrFactory<T> = T | ((resolve: Resolve) => T)

interface ResolvableContainer {
  resolve: Resolve
}

/**
 * Normalises an `OptionsOrFactory<T>` against a DI container: calls the factory
 * with a resolver bound to the container, or returns the options as-is.
 */
export function resolveOptions<T>(optionsOrFactory: OptionsOrFactory<T>, container: ResolvableContainer): T {
  return typeof optionsOrFactory === 'function'
    ? (optionsOrFactory as (resolve: Resolve) => T)((token) => container.resolve(token))
    : optionsOrFactory
}
