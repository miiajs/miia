import { describe, expect, it } from 'bun:test'
import { Miia, type RequestContext } from '@miiajs/core'
import { fromCookie, fromHeader, type TokenExtractor } from '../src/index.js'

async function extract(extractor: TokenExtractor, headers: Record<string, string>): Promise<string | null> {
  const app = new Miia({ logger: false }).addRoute('GET', '/', (ctx: RequestContext) => ({ token: extractor(ctx) }))
  const res = await app.fetch(new Request('http://localhost/', { headers }))
  return (await res.json()).token
}

describe('fromHeader', () => {
  it('reads a Bearer token', async () => {
    expect(await extract(fromHeader(), { authorization: 'Bearer abc' })).toBe('abc')
  })

  it('matches the scheme case-insensitively', async () => {
    expect(await extract(fromHeader(), { authorization: 'bearer abc' })).toBe('abc')
    expect(await extract(fromHeader(), { authorization: 'BEARER abc' })).toBe('abc')
  })

  it('skips extra spaces before the token', async () => {
    expect(await extract(fromHeader(), { authorization: 'Bearer   abc' })).toBe('abc')
  })

  it('rejects another scheme, a glued token and an empty token', async () => {
    expect(await extract(fromHeader(), { authorization: 'Basic abc' })).toBeNull()
    expect(await extract(fromHeader(), { authorization: 'Bearerabc' })).toBeNull()
    expect(await extract(fromHeader(), { authorization: 'Bearer ' })).toBeNull()
    expect(await extract(fromHeader(), {})).toBeNull()
  })

  it('returns the whole value without a scheme', async () => {
    expect(await extract(fromHeader('x-api-key', ''), { 'x-api-key': 'Key 123' })).toBe('Key 123')
  })

  it('takes a custom scheme', async () => {
    expect(await extract(fromHeader('authorization', 'Token'), { authorization: 'token t1' })).toBe('t1')
  })
})

describe('fromCookie', () => {
  it('reads the raw value of the named cookie', async () => {
    expect(await extract(fromCookie('access_token'), { cookie: 'a=1; access_token=x.y.z; b=2' })).toBe('x.y.z')
    expect(await extract(fromCookie('access_token'), { cookie: 'a=1' })).toBeNull()
  })

  it('matches the name literally', async () => {
    expect(await extract(fromCookie('a.b'), { cookie: 'axb=wrong; a.b=right' })).toBe('right')
    expect(await extract(fromCookie('t+'), { cookie: 't+=plus' })).toBe('plus')
  })

  it('does not match a cookie whose name ends with the name', async () => {
    expect(await extract(fromCookie('token'), { cookie: 'xtoken=1' })).toBeNull()
  })
})
