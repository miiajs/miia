import { describe, expect, it } from 'bun:test'
import type { ConnInfo, RequestContext } from '../src/index.js'
import { Controller, Get, Miia, Module } from '../src/index.js'
import { TestApp } from '../src/testing/index.js'

// Resolve ctx.conn / ctx.ip for a single request through a real Miia instance.
// Returns the values captured inside the route handler.
async function probe(
  options: ConstructorParameters<typeof Miia>[0],
  req: Request,
  env?: unknown,
): Promise<{ conn: ConnInfo; ip: string | undefined }> {
  const app = new Miia({ logger: false, ...options })
  let captured: { conn: ConnInfo; ip: string | undefined } = { conn: {}, ip: undefined }
  app.addRoute('GET', '/', (ctx: RequestContext) => {
    captured = { conn: ctx.conn, ip: ctx.ip }
    return null
  })
  await app.fetch(req, env)
  return captured
}

describe('ctx.conn source priority', () => {
  it('prefers req._conn over runtime env', async () => {
    const req = new Request('http://localhost/')
    ;(req as any)._conn = { remoteAddress: '10.0.0.1', remotePort: 1234, family: 'IPv4' }
    const bunEnv = { requestIP: () => ({ address: '9.9.9.9', port: 80, family: 'IPv4' }) }
    const { conn } = await probe({}, req, bunEnv)
    expect(conn).toEqual({ remoteAddress: '10.0.0.1', remotePort: 1234, family: 'IPv4' })
  })

  it('maps Bun requestIP fields explicitly', async () => {
    const bunEnv = { requestIP: () => ({ address: '1.2.3.4', port: 5678, family: 'IPv4' }) }
    const { conn } = await probe({}, new Request('http://localhost/'), bunEnv)
    expect(conn).toEqual({ remoteAddress: '1.2.3.4', remotePort: 5678, family: 'IPv4' })
  })

  it('maps Bun IPv6 requestIP', async () => {
    const bunEnv = { requestIP: () => ({ address: '::1', port: 5678, family: 'IPv6' }) }
    const { conn } = await probe({}, new Request('http://localhost/'), bunEnv)
    expect(conn).toEqual({ remoteAddress: '::1', remotePort: 5678, family: 'IPv6' })
  })

  it('returns {} when Bun requestIP gives null (closed connection)', async () => {
    const bunEnv = { requestIP: () => null }
    const { conn } = await probe({}, new Request('http://localhost/'), bunEnv)
    expect(conn).toEqual({})
  })

  it('reads Deno remoteAddr (IPv4)', async () => {
    const denoEnv = { remoteAddr: { hostname: '203.0.113.5', port: 443 } }
    const { conn } = await probe({}, new Request('http://localhost/'), denoEnv)
    expect(conn).toEqual({ remoteAddress: '203.0.113.5', remotePort: 443, family: 'IPv4' })
  })

  it('reads Deno remoteAddr (IPv6 detected by colon)', async () => {
    const denoEnv = { remoteAddr: { hostname: '2001:db8::1', port: 443 } }
    const { conn } = await probe({}, new Request('http://localhost/'), denoEnv)
    expect(conn).toEqual({ remoteAddress: '2001:db8::1', remotePort: 443, family: 'IPv6' })
  })

  it('returns {} when no source is available', async () => {
    const { conn, ip } = await probe({}, new Request('http://localhost/'))
    expect(conn).toEqual({})
    expect(ip).toBeUndefined()
  })
})

describe('ctx.conn caching', () => {
  it('returns the same object and calls requestIP once', async () => {
    let calls = 0
    const bunEnv = {
      requestIP: () => {
        calls++
        return { address: '1.1.1.1', port: 80, family: 'IPv4' }
      },
    }
    const app = new Miia({ logger: false })
    let same = false
    app.addRoute('GET', '/', (ctx: RequestContext) => {
      same = ctx.conn === ctx.conn
      // touch again to ensure the getter is memoized
      void ctx.conn
      return null
    })
    await app.fetch(new Request('http://localhost/'), bunEnv)
    expect(same).toBe(true)
    expect(calls).toBe(1)
  })
})

describe('ctx.ip with trustProxy', () => {
  it('default (false) ignores x-forwarded-for and uses socket', async () => {
    const req = new Request('http://localhost/', { headers: { 'x-forwarded-for': '1.1.1.1' } })
    ;(req as any)._conn = { remoteAddress: '10.0.0.1' }
    const { ip } = await probe({}, req)
    expect(ip).toBe('10.0.0.1')
  })

  it('true -> leftmost x-forwarded-for, trimmed', async () => {
    const req = new Request('http://localhost/', { headers: { 'x-forwarded-for': ' 1.1.1.1 , 2.2.2.2' } })
    ;(req as any)._conn = { remoteAddress: '10.0.0.1' }
    const { ip } = await probe({ trustProxy: true }, req)
    expect(ip).toBe('1.1.1.1')
  })

  it('string header -> takes its value as-is, ignores XFF', async () => {
    const req = new Request('http://localhost/', {
      headers: { 'cf-connecting-ip': '3.3.3.3', 'x-forwarded-for': '9.9.9.9' },
    })
    ;(req as any)._conn = { remoteAddress: '10.0.0.1' }
    const { ip } = await probe({ trustProxy: 'cf-connecting-ip' }, req)
    expect(ip).toBe('3.3.3.3')
  })

  it('array -> first present header wins', async () => {
    const req = new Request('http://localhost/', { headers: { 'x-real-ip': '4.4.4.4' } })
    ;(req as any)._conn = { remoteAddress: '10.0.0.1' }
    const { ip } = await probe({ trustProxy: ['cf-connecting-ip', 'x-real-ip'] }, req)
    expect(ip).toBe('4.4.4.4')
  })

  it('array -> falls back to socket when no header is present', async () => {
    const req = new Request('http://localhost/')
    ;(req as any)._conn = { remoteAddress: '10.0.0.1' }
    const { ip } = await probe({ trustProxy: ['cf-connecting-ip', 'x-real-ip'] }, req)
    expect(ip).toBe('10.0.0.1')
  })

  it('x-forwarded-for inside an array still gets leftmost logic', async () => {
    const req = new Request('http://localhost/', { headers: { 'x-forwarded-for': '5.5.5.5, 6.6.6.6' } })
    ;(req as any)._conn = { remoteAddress: '10.0.0.1' }
    const { ip } = await probe({ trustProxy: ['cf-connecting-ip', 'x-forwarded-for'] }, req)
    expect(ip).toBe('5.5.5.5')
  })

  it('header names are normalized case-insensitively', async () => {
    const req = new Request('http://localhost/', { headers: { 'cf-connecting-ip': '7.7.7.7' } })
    ;(req as any)._conn = { remoteAddress: '10.0.0.1' }
    const { ip } = await probe({ trustProxy: 'CF-Connecting-IP' }, req)
    expect(ip).toBe('7.7.7.7')
  })

  it('empty/whitespace trusted value falls through to socket', async () => {
    const req = new Request('http://localhost/', { headers: { 'cf-connecting-ip': '   ' } })
    ;(req as any)._conn = { remoteAddress: '10.0.0.1' }
    const { ip } = await probe({ trustProxy: 'cf-connecting-ip' }, req)
    expect(ip).toBe('10.0.0.1')
  })

  it('empty leftmost XFF drops the whole header to socket', async () => {
    const req = new Request('http://localhost/', { headers: { 'x-forwarded-for': ' , 2.2.2.2' } })
    ;(req as any)._conn = { remoteAddress: '10.0.0.1' }
    const { ip } = await probe({ trustProxy: true }, req)
    expect(ip).toBe('10.0.0.1')
  })
})

describe('TestApp.request ip option', () => {
  it('injects _conn with the given remoteAddress', async () => {
    let seenIp: string | undefined
    let seenConn: ConnInfo = {}

    @Controller('/')
    class ProbeController {
      @Get()
      handle(ctx: RequestContext) {
        seenIp = ctx.ip
        seenConn = ctx.conn
        return null
      }
    }

    @Module({ controllers: [ProbeController] })
    class ProbeModule {}

    const app = await TestApp.create(ProbeModule).compile()
    await app.request('GET', '/', { ip: '8.8.8.8' })
    expect(seenIp).toBe('8.8.8.8')
    expect(seenConn).toEqual({ remoteAddress: '8.8.8.8' })
    await app.close()
  })
})
