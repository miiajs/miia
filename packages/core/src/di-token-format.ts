import type { AnyToken, Constructor } from './types.js'

export function formatToken(token: AnyToken): string {
  return token.name || '<anonymous>'
}

/** A module of the graph by its pair (class, name). */
export function formatPair(cls: Constructor, name: string): string {
  return name ? `${formatToken(cls)} (name '${name}')` : formatToken(cls)
}
