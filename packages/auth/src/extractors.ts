import type { RequestContext } from '@miiajs/core'

export type TokenExtractor = (ctx: RequestContext) => string | null

export function fromHeader(header = 'authorization', scheme = 'Bearer'): TokenExtractor {
  const prefix = scheme.toLowerCase()
  return (ctx) => {
    const value = ctx.req.headers.get(header)
    if (!value) return null
    if (!scheme) return value
    // RFC 9110 11.1: the scheme is case-insensitive, one or more spaces separate it from the credentials
    if (value[prefix.length] !== ' ' || value.slice(0, prefix.length).toLowerCase() !== prefix) return null
    return value.slice(prefix.length + 1).trimStart() || null
  }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function fromCookie(name: string): TokenExtractor {
  // The name is matched literally: `a.b` must not match `axb`
  const pattern = new RegExp(`(?:^|;\\s*)${escapeRegExp(name)}=([^;]+)`)
  return (ctx) => {
    const cookie = ctx.req.headers.get('cookie')
    if (!cookie) return null
    return cookie.match(pattern)?.[1] ?? null
  }
}

export function fromQuery(param: string): TokenExtractor {
  return (ctx) => ctx.query[param] ?? null
}
