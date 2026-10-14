import type { Constructor } from './types.js'

export function formatToken(token: string | Constructor): string {
  if (typeof token === 'string') return token
  const name = (token as { __name?: unknown }).__name
  if (typeof name === 'string') return name
  return token.name || '<anonymous>'
}
