import type { AnyToken } from './types.js'

export function formatToken(token: AnyToken): string {
  return token.name || '<anonymous>'
}
