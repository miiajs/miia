import type { AnyToken, Constructor } from './types.js'

/** The label of a token in messages: `kind(name)` for a token object with a kind, else its name (a class's name). */
export function formatToken(token: AnyToken): string {
  if (typeof token !== 'function' && typeof token.kind === 'string') return `${token.kind}(${token.name})`
  return token.name || '<anonymous>'
}

/** A module of the graph by its pair (class, name). */
export function formatPair(cls: Constructor, name: string): string {
  return name ? `${formatToken(cls)} (name '${name}')` : formatToken(cls)
}
