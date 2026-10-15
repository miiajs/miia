import type { AbstractConstructor, AnyToken, FactoryProvider, Resolve, Scope, Token } from './types.js'

/**
 * Creates a typed DI token. Every call returns a new token, even for the same name.
 * `hint` names what provides the token (e.g. `'MailModule.configure()'`) and shows up in "No provider" errors.
 */
export function createToken<T>(name: string, options?: { hint?: string }): Token<T> {
  const hint = options?.hint
  return Object.freeze(hint === undefined ? { name } : { name, hint }) as Token<T>
}

/** A factory provider whose factory is checked against the token's type. */
export function provider<T>(
  token: Token<T> | AbstractConstructor<T>,
  factory: (resolve: Resolve) => T,
  options?: { scope?: Scope; deps?: readonly AnyToken[] },
): FactoryProvider<T> {
  return { token, factory, scope: options?.scope, deps: options?.deps }
}
