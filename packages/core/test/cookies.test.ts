import { describe, expect, it } from 'bun:test'
import type { RequestContext } from '@miiajs/core'
import { Controller, Get, Module, parseCookieHeader, ResponseBuilder, serializeCookie } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'

describe('serializeCookie', () => {
  it('serializes name/value with all attributes', () => {
    const str = serializeCookie('sid', 'abc', {
      domain: 'example.com',
      path: '/app',
      expires: new Date('2030-01-01T00:00:00Z'),
      maxAge: 3600,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      priority: 'high',
      partitioned: true,
    })
    expect(str).toContain('sid=abc')
    expect(str).toContain('Domain=example.com')
    expect(str).toContain('Path=/app')
    expect(str).toContain('Expires=Tue, 01 Jan 2030 00:00:00 GMT')
    expect(str).toContain('Max-Age=3600')
    expect(str).toContain('HttpOnly')
    expect(str).toContain('Secure')
    expect(str).toContain('SameSite=Lax')
    expect(str).toContain('Priority=High')
    expect(str).toContain('Partitioned')
  })

  it('URI-encodes the value', () => {
    expect(serializeCookie('c', 'a b=c;d')).toBe('c=a%20b%3Dc%3Bd')
  })

  it('does not default path (low-level primitive)', () => {
    expect(serializeCookie('c', 'v')).toBe('c=v')
  })

  it('auto-enables Secure for SameSite=None', () => {
    expect(serializeCookie('c', 'v', { sameSite: 'none' })).toContain('Secure')
    expect(serializeCookie('c', 'v', { sameSite: 'none' })).toContain('SameSite=None')
  })

  it('throws on explicit secure: false with SameSite=None', () => {
    expect(() => serializeCookie('c', 'v', { sameSite: 'none', secure: false })).toThrow(TypeError)
  })

  it('throws on partitioned without Secure', () => {
    expect(() => serializeCookie('c', 'v', { partitioned: true })).toThrow(TypeError)
  })

  it('allows partitioned with secure: true', () => {
    const str = serializeCookie('c', 'v', { partitioned: true, secure: true })
    expect(str).toContain('Partitioned')
    expect(str).toContain('Secure')
  })

  it('allows partitioned with SameSite=None (auto-Secure)', () => {
    const str = serializeCookie('c', 'v', { partitioned: true, sameSite: 'none' })
    expect(str).toContain('Partitioned')
    expect(str).toContain('Secure')
  })

  it('throws on partitioned with secure: false', () => {
    expect(() => serializeCookie('c', 'v', { partitioned: true, secure: false })).toThrow(TypeError)
  })

  it('throws the SameSite=None error first for partitioned + secure: false + SameSite=None', () => {
    expect(() => serializeCookie('c', 'v', { partitioned: true, secure: false, sameSite: 'none' })).toThrow(
      'SameSite=None requires Secure; remove secure: false or use a different sameSite',
    )
  })

  it('emits Max-Age=0 (not dropped as falsy)', () => {
    expect(serializeCookie('c', 'v', { maxAge: 0 })).toContain('Max-Age=0')
  })

  it('floors fractional Max-Age', () => {
    expect(serializeCookie('c', 'v', { maxAge: 12.9 })).toContain('Max-Age=12')
  })

  it('throws on invalid cookie name', () => {
    expect(() => serializeCookie('bad name', 'v')).toThrow(TypeError)
    expect(() => serializeCookie('a=b', 'v')).toThrow(TypeError)
  })

  it('throws on CRLF/control chars in path', () => {
    expect(() => serializeCookie('c', 'v', { path: '/a\r\nSet-Cookie: x=y' })).toThrow(TypeError)
    expect(() => serializeCookie('c', 'v', { path: '/a;b' })).toThrow(TypeError)
  })

  it('throws on CRLF/control chars in domain', () => {
    expect(() => serializeCookie('c', 'v', { domain: 'ex\r\nample.com' })).toThrow(TypeError)
    expect(() => serializeCookie('c', 'v', { domain: 'ex;ample.com' })).toThrow(TypeError)
  })

  it('throws on non-finite Max-Age', () => {
    expect(() => serializeCookie('c', 'v', { maxAge: Number.NaN })).toThrow(TypeError)
    expect(() => serializeCookie('c', 'v', { maxAge: Number.POSITIVE_INFINITY })).toThrow(TypeError)
    expect(() => serializeCookie('c', 'v', { maxAge: Number.NEGATIVE_INFINITY })).toThrow(TypeError)
  })

  it('does not throw on zero or negative Max-Age', () => {
    expect(() => serializeCookie('c', 'v', { maxAge: 0 })).not.toThrow()
    expect(() => serializeCookie('c', 'v', { maxAge: -1 })).not.toThrow()
  })

  it('throws on an invalid expires Date', () => {
    expect(() => serializeCookie('c', 'v', { expires: new Date(Number.NaN) })).toThrow(TypeError)
  })
})

describe('parseCookieHeader', () => {
  it('decodes URI-encoded values', () => {
    expect(parseCookieHeader('c=a%20b%3Dc')).toEqual({ c: 'a b=c' })
  })

  it('parses multiple cookies', () => {
    expect(parseCookieHeader('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' })
  })

  it('strips surrounding double quotes', () => {
    expect(parseCookieHeader('c="quoted value"')).toEqual({ c: 'quoted value' })
  })

  it('skips malformed pairs without =', () => {
    expect(parseCookieHeader('a=1; garbage; b=2')).toEqual({ a: '1', b: '2' })
  })

  it('returns raw value on malformed encoding', () => {
    expect(parseCookieHeader('c=%E0%A4%A')).toEqual({ c: '%E0%A4%A' })
  })

  it('first-wins on duplicate names', () => {
    expect(parseCookieHeader('c=first; c=second')).toEqual({ c: 'first' })
  })

  it('returns empty object for empty header', () => {
    expect(parseCookieHeader('')).toEqual({})
  })

  it('parses cookie names that collide with Object.prototype members', () => {
    const parsed = parseCookieHeader('toString=abc; constructor=1')
    expect(parsed.toString).toBe('abc')
    expect(parsed.constructor).toBe('1')
  })

  it('stores __proto__ as an own property without mutating the prototype', () => {
    const parsed = parseCookieHeader('__proto__=x')
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true)
    expect((parsed as Record<string, string>).__proto__).toBe('x')
    expect(Object.getPrototypeOf(parsed)).toBe(null)
  })
})

describe('ResponseBuilder cookies', () => {
  it('accumulates multiple Set-Cookie headers via append', () => {
    const res = new ResponseBuilder()
    res.cookie('a', '1').cookie('b', '2')
    const built = res.build()
    expect(built.headers.getSetCookie().length).toBe(2)
  })

  it('marks the response modified', () => {
    const res = new ResponseBuilder()
    res.cookie('a', '1')
    expect(res._modified).toBe(true)
  })

  it('defaults path to /', () => {
    const res = new ResponseBuilder()
    res.cookie('a', '1')
    expect(res.build().headers.getSetCookie()[0]).toContain('Path=/')
  })

  it('deleteCookie emits Max-Age=0 and epoch Expires', () => {
    const res = new ResponseBuilder()
    res.deleteCookie('a')
    const header = res.build().headers.getSetCookie()[0]
    expect(header).toContain('Max-Age=0')
    expect(header).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    expect(header).toContain('Path=/')
  })
})

describe('cookies integration via TestApp', () => {
  it('sets a cookie alongside a plain-object return (fast-path opt-out)', async () => {
    @Controller('/')
    class CookieController {
      @Get('set')
      set(ctx: RequestContext) {
        ctx.cookies.set('sid', 'abc', { httpOnly: true, sameSite: 'lax', maxAge: 3600 })
        return { ok: true }
      }
    }

    @Module({ controllers: [CookieController] })
    class CookieModule {}

    const app = await TestApp.create(CookieModule).compile()
    const res = await app.request('GET', '/set')
    const cookies = res.headers.getSetCookie()
    expect(cookies.length).toBe(1)
    expect(cookies[0]).toContain('sid=abc')
    expect(cookies[0]).toContain('HttpOnly')
    expect(cookies[0]).toContain('SameSite=Lax')
    expect(cookies[0]).toContain('Max-Age=3600')
    expect(cookies[0]).toContain('Path=/')
    expect(await res.json()).toEqual({ ok: true })
    await app.close()
  })

  it('reads an incoming cookie via ctx.cookies.get (round-trip)', async () => {
    let seen: string | undefined
    let hasIt = false

    @Controller('/')
    class ReadController {
      @Get('read')
      read(ctx: RequestContext) {
        seen = ctx.cookies.get('sid')
        hasIt = ctx.cookies.has('sid')
        return null
      }
    }

    @Module({ controllers: [ReadController] })
    class ReadModule {}

    const app = await TestApp.create(ReadModule).compile()
    await app.request('GET', '/read', { headers: { Cookie: 'sid=abc; other=xyz' } })
    expect(seen).toBe('abc')
    expect(hasIt).toBe(true)
    await app.close()
  })

  it('does not leak Object.prototype members for absent cookies', async () => {
    let hasToString = true
    let getToString: string | undefined = 'sentinel'

    @Controller('/')
    class ProtoController {
      @Get('proto')
      proto(ctx: RequestContext) {
        hasToString = ctx.cookies.has('toString')
        getToString = ctx.cookies.get('toString')
        return null
      }
    }

    @Module({ controllers: [ProtoController] })
    class ProtoModule {}

    const app = await TestApp.create(ProtoModule).compile()
    await app.request('GET', '/proto')
    expect(hasToString).toBe(false)
    expect(getToString).toBeUndefined()
    await app.close()
  })

  it('reads a cookie named toString', async () => {
    let seen: string | undefined
    let hasIt = false

    @Controller('/')
    class ProtoReadController {
      @Get('proto-read')
      read(ctx: RequestContext) {
        seen = ctx.cookies.get('toString')
        hasIt = ctx.cookies.has('toString')
        return null
      }
    }

    @Module({ controllers: [ProtoReadController] })
    class ProtoReadModule {}

    const app = await TestApp.create(ProtoReadModule).compile()
    await app.request('GET', '/proto-read', { headers: { Cookie: 'toString=abc' } })
    expect(seen).toBe('abc')
    expect(hasIt).toBe(true)
    await app.close()
  })

  it('getAll returns a snapshot copy - mutation does not affect later reads', async () => {
    let afterMutation: string | undefined

    @Controller('/')
    class GetAllController {
      @Get('all')
      all(ctx: RequestContext) {
        const all = ctx.cookies.getAll()
        all.sid = 'mutated'
        delete all.other
        afterMutation = ctx.cookies.get('sid')
        return null
      }
    }

    @Module({ controllers: [GetAllController] })
    class GetAllModule {}

    const app = await TestApp.create(GetAllModule).compile()
    await app.request('GET', '/all', { headers: { Cookie: 'sid=abc; other=xyz' } })
    expect(afterMutation).toBe('abc')
    await app.close()
  })
})
