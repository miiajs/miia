import type { RequestContext } from '@miiajs/core'

export type TokenExtractor = (ctx: RequestContext) => string | null

export function fromHeader(header = 'authorization', scheme = 'Bearer'): TokenExtractor {
  return (ctx) => {
    const value = ctx.req.headers.get(header)
    if (!value) return null
    if (!scheme) return value
    if (!value.startsWith(scheme + ' ')) return null
    return value.slice(scheme.length + 1)
  }
}

export function fromCookie(name: string): TokenExtractor {
  return (ctx) => {
    const cookie = ctx.req.headers.get('cookie')
    if (!cookie) return null
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
    return match?.[1] ?? null
  }
}

export function fromQuery(param: string): TokenExtractor {
  return (ctx) => ctx.query[param] ?? null
}
