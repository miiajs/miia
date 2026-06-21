import { describe, expect, it } from 'bun:test'
import type { RequestContext } from '@miiajs/core'
import { Controller, Get, Module } from '@miiajs/core'
import { TestApp } from '@miiajs/core/testing'
import { rateLimit } from '../src/index.js'

@Controller('/ping')
class PingController {
  @Get('/')
  ping(_ctx: RequestContext) {
    return { ok: true }
  }
}

@Module({ controllers: [PingController] })
class AppModule {}

describe('rateLimit middleware', () => {
  it('allows up to the limit, then returns 429 with the standard envelope', async () => {
    const app = await TestApp.create(AppModule)
      .use(rateLimit({ limit: 2, window: '1m' }))
      .compile()

    expect((await app.request('GET', '/ping/', { ip: '1.1.1.1' })).status).toBe(200)
    expect((await app.request('GET', '/ping/', { ip: '1.1.1.1' })).status).toBe(200)

    const blocked = await app.request('GET', '/ping/', { ip: '1.1.1.1' })
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too Many Requests',
      details: { retryAfter: expect.any(Number) },
    })

    await app.close()
  })

  it('sets draft-6 headers on success and on 429', async () => {
    const app = await TestApp.create(AppModule)
      .use(rateLimit({ limit: 1, window: '1m' }))
      .compile()

    const ok = await app.request('GET', '/ping/', { ip: '2.2.2.2' })
    expect(ok.headers.get('RateLimit-Limit')).toBe('1')
    expect(ok.headers.get('RateLimit-Remaining')).toBe('0')
    expect(ok.headers.get('RateLimit-Reset')).not.toBeNull()
    expect(ok.headers.get('RateLimit-Policy')).toBe('1;w=60')
    expect(ok.headers.get('Retry-After')).toBeNull()

    const blocked = await app.request('GET', '/ping/', { ip: '2.2.2.2' })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('RateLimit-Limit')).toBe('1')
    expect(blocked.headers.get('RateLimit-Remaining')).toBe('0')
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)

    await app.close()
  })

  it('emits legacy X-RateLimit-* headers when mode is legacy', async () => {
    const app = await TestApp.create(AppModule)
      .use(rateLimit({ limit: 5, window: '1m', headers: 'legacy' }))
      .compile()

    const res = await app.request('GET', '/ping/', { ip: '3.3.3.3' })
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
    expect(res.headers.get('RateLimit-Limit')).toBeNull()

    await app.close()
  })

  it('omits all RateLimit headers when mode is false but still sets Retry-After on 429', async () => {
    const app = await TestApp.create(AppModule)
      .use(rateLimit({ limit: 1, window: '1m', headers: false }))
      .compile()

    const ok = await app.request('GET', '/ping/', { ip: '4.4.4.4' })
    expect(ok.headers.get('RateLimit-Limit')).toBeNull()
    expect(ok.headers.get('X-RateLimit-Limit')).toBeNull()

    const blocked = await app.request('GET', '/ping/', { ip: '4.4.4.4' })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('RateLimit-Limit')).toBeNull()
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)

    await app.close()
  })

  it('skips rate limiting when skip() returns true', async () => {
    const app = await TestApp.create(AppModule)
      .use(rateLimit({ limit: 1, window: '1m', skip: (ctx) => ctx.req.headers.get('x-skip') === 'yes' }))
      .compile()

    expect((await app.request('GET', '/ping/', { ip: '5.5.5.5' })).status).toBe(200)
    // Without skip this would 429; with the skip header it passes.
    expect((await app.request('GET', '/ping/', { ip: '5.5.5.5', headers: { 'x-skip': 'yes' } })).status).toBe(200)

    await app.close()
  })

  it('keys per ip - distinct ips have independent budgets', async () => {
    const app = await TestApp.create(AppModule)
      .use(rateLimit({ limit: 1, window: '1m' }))
      .compile()

    expect((await app.request('GET', '/ping/', { ip: '6.6.6.6' })).status).toBe(200)
    expect((await app.request('GET', '/ping/', { ip: '6.6.6.6' })).status).toBe(429)
    // Different ip, fresh budget.
    expect((await app.request('GET', '/ping/', { ip: '7.7.7.7' })).status).toBe(200)

    await app.close()
  })

  it("falls back to the 'unknown' key when no ip is present", async () => {
    const app = await TestApp.create(AppModule)
      .use(rateLimit({ limit: 1, window: '1m' }))
      .compile()

    // No ip on either request -> both share the 'unknown' bucket.
    expect((await app.request('GET', '/ping/')).status).toBe(200)
    expect((await app.request('GET', '/ping/')).status).toBe(429)

    await app.close()
  })

  it('custom keyGenerator buckets by header, not ip', async () => {
    const app = await TestApp.create(AppModule)
      .use(
        rateLimit({ limit: 1, window: '1m', keyGenerator: (ctx) => ctx.req.headers.get('x-client-id') ?? 'unknown' }),
      )
      .compile()

    // First request for 'alice' passes.
    expect((await app.request('GET', '/ping/', { ip: '1.1.1.1', headers: { 'x-client-id': 'alice' } })).status).toBe(
      200,
    )
    // Same client-id, different ip -> same bucket, blocked.
    expect((await app.request('GET', '/ping/', { ip: '2.2.2.2', headers: { 'x-client-id': 'alice' } })).status).toBe(
      429,
    )
    // Different client-id -> fresh bucket.
    expect((await app.request('GET', '/ping/', { ip: '3.3.3.3', headers: { 'x-client-id': 'bob' } })).status).toBe(200)

    await app.close()
  })
})
