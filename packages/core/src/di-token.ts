import type { AbstractConstructor, AnyToken, FactoryProvider, Resolve, Scope, Token } from './types.js'

/** The `shared` key of a factory provider built by `provider()`. @internal */
export const SHARED_PROVIDER = Symbol('miia.sharedProvider')

/**
 * Creates a typed DI token. Every call returns a new token, even for the same name.
 * `hint` names what provides the token (e.g. `'MailModule.configure()'`) and shows up in "No provider" errors.
 */
export function createToken<T>(name: string, options?: { hint?: string }): Token<T> {
  const hint = options?.hint
  return Object.freeze(hint === undefined ? { name } : { name, hint }) as Token<T>
}

/**
 * A factory provider whose factory is checked against the token's type.
 *
 * `shared`: several modules may declare the token, each with a provider marked by the same key, and get one instance
 * that every declaring module owns and may export. The first declaration builds it; what it injects is checked from
 * every declaring module. A different key, or an unmarked declaration of the same token, is an error. The key also
 * names the variant in that error (e.g. `connection 'analytics'`).
 */
export function provider<T>(
  token: Token<T> | AbstractConstructor<T>,
  factory: (resolve: Resolve) => T,
  options?: { scope?: Scope; deps?: readonly AnyToken[]; shared?: string },
): FactoryProvider<T> {
  const result: FactoryProvider<T> = { token, factory, scope: options?.scope, deps: options?.deps }
  const shared = options?.shared
  return shared === undefined ? result : Object.assign(result, { [SHARED_PROVIDER]: shared })
}
