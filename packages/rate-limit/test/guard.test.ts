import { describe, expect, it } from 'bun:test'
import type { RequestContext } from '@miiajs/core'
import { Controller, Get, Module, UseGuard } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { RateLimit, RateLimitGuard, RateLimitModule, SkipRateLimit } from '../src/index.js'

describe('RateLimitGuard', () => {
  it('bare global guard (via module) limits and returns 429', async () => {
    @Controller('/g')
    class GController {
      @Get('/')
      hit(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({
      imports: [RateLimitModule.configure({ limit: 2, window: '1m' })],
      controllers: [GController],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).useGuard(RateLimitGuard).compile()

    expect((await app.request('GET', '/g/', { ip: '1.1.1.1' })).status).toBe(200)
    expect((await app.request('GET', '/g/', { ip: '1.1.1.1' })).status).toBe(200)
    const blocked = await app.request('GET', '/g/', { ip: '1.1.1.1' })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('RateLimit-Limit')).toBe('2')
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)

    await app.close()
  })

  it('@RateLimit override wins over the module policy', async () => {
    @Controller('/o')
    class OController {
      // Override: limit 1, tighter than the module's 100.
      @Get('/')
      @RateLimit({ limit: 1, window: '1m' })
      hit(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({
      imports: [RateLimitModule.configure({ limit: 100, window: '1m' })],
      controllers: [OController],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).compile()

    const ok = await app.request('GET', '/o/', { ip: '2.2.2.2' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('RateLimit-Limit')).toBe('1')
    expect((await app.request('GET', '/o/', { ip: '2.2.2.2' })).status).toBe(429)

    await app.close()
  })

  it('@SkipRateLimit bypasses both the global and the factory guard', async () => {
    @Controller('/s')
    class SController {
      @Get('/limited')
      limited(_ctx: RequestContext) {
        return { ok: true }
      }

      // Bypasses the global guard registered via useGuard(RateLimitGuard).
      @Get('/global-skip')
      @SkipRateLimit()
      globalSkip(_ctx: RequestContext) {
        return { ok: true }
      }

      // A factory guard plus a skip of the same guard -> no limiting.
      @Get('/factory-skip')
      @RateLimit({ limit: 1, window: '1m' })
      @SkipRateLimit()
      factorySkip(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({
      imports: [RateLimitModule.configure({ limit: 1, window: '1m' })],
      controllers: [SController],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).useGuard(RateLimitGuard).compile()

    // Global guard active on the limited route.
    expect((await app.request('GET', '/s/limited', { ip: '3.3.3.3' })).status).toBe(200)
    expect((await app.request('GET', '/s/limited', { ip: '3.3.3.3' })).status).toBe(429)

    // Global guard skipped -> never limited.
    for (let i = 0; i < 5; i++) {
      expect((await app.request('GET', '/s/global-skip', { ip: '3.3.3.3' })).status).toBe(200)
    }

    // Factory guard skipped -> never limited.
    for (let i = 0; i < 5; i++) {
      expect((await app.request('GET', '/s/factory-skip', { ip: '3.3.3.3' })).status).toBe(200)
    }

    await app.close()
  })

  it('bare guard WITHOUT a module fails at compile() with a helpful error', async () => {
    @Controller('/b')
    class BController {
      @Get('/')
      hit(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({ controllers: [BController] })
    class AppModule {}

    const promise = TestApp.create(AppModule).useGuard(RateLimitGuard).compile()
    await expect(promise).rejects.toThrow('RateLimitGuard used without configuration')

    await promise.catch(() => {})
  })

  // ─── Replacement semantics (method > class > global, by the @BodyLimit precedent) ───

  it('method @RateLimit replaces the global guard and never spends the global quota', async () => {
    @Controller('/m')
    class MController {
      // Decorated: its own limit of 3, replaces the global guard on this route.
      @Get('/decorated')
      @RateLimit({ limit: 3, window: '1m' })
      decorated(_ctx: RequestContext) {
        return { ok: true }
      }

      // Plain: stays under the global guard (limit 2).
      @Get('/plain')
      plain(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({
      imports: [RateLimitModule.configure({ limit: 2, window: '1m' })],
      controllers: [MController],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).useGuard(RateLimitGuard).compile()

    // Decorated route lives by its own limit of 3.
    const first = await app.request('GET', '/m/decorated', { ip: '4.4.4.4' })
    expect(first.status).toBe(200)
    expect(first.headers.get('RateLimit-Limit')).toBe('3')
    expect((await app.request('GET', '/m/decorated', { ip: '4.4.4.4' })).status).toBe(200)
    expect((await app.request('GET', '/m/decorated', { ip: '4.4.4.4' })).status).toBe(200)
    expect((await app.request('GET', '/m/decorated', { ip: '4.4.4.4' })).status).toBe(429)

    // The plain route still has its full global quota of 2 - the 4 decorated
    // requests did not consume it.
    expect((await app.request('GET', '/m/plain', { ip: '4.4.4.4' })).status).toBe(200)
    expect((await app.request('GET', '/m/plain', { ip: '4.4.4.4' })).status).toBe(200)
    expect((await app.request('GET', '/m/plain', { ip: '4.4.4.4' })).status).toBe(429)

    await app.close()
  })

  it('class @RateLimit replaces the global guard for every route of the controller', async () => {
    @Controller('/c')
    @RateLimit({ limit: 2, window: '1m' })
    class CController {
      @Get('/a')
      a(_ctx: RequestContext) {
        return { ok: true }
      }

      @Get('/b')
      b(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({
      imports: [RateLimitModule.configure({ limit: 100, window: '1m' })],
      controllers: [CController],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).useGuard(RateLimitGuard).compile()

    // Both routes are governed by the class policy (limit 2), not the global 100.
    const ra = await app.request('GET', '/c/a', { ip: '5.5.5.5' })
    expect(ra.status).toBe(200)
    expect(ra.headers.get('RateLimit-Limit')).toBe('2')
    expect((await app.request('GET', '/c/a', { ip: '5.5.5.5' })).status).toBe(200)
    expect((await app.request('GET', '/c/a', { ip: '5.5.5.5' })).status).toBe(429)

    const rb = await app.request('GET', '/c/b', { ip: '6.6.6.6' })
    expect(rb.status).toBe(200)
    expect(rb.headers.get('RateLimit-Limit')).toBe('2')
    expect((await app.request('GET', '/c/b', { ip: '6.6.6.6' })).status).toBe(200)
    expect((await app.request('GET', '/c/b', { ip: '6.6.6.6' })).status).toBe(429)

    await app.close()
  })

  it('method @RateLimit replaces the class @RateLimit on that route only', async () => {
    @Controller('/mc')
    @RateLimit({ limit: 1, window: '1m' })
    class MCController {
      // Method override: its own limit of 3, replaces the class limit.
      @Get('/override')
      @RateLimit({ limit: 3, window: '1m' })
      override(_ctx: RequestContext) {
        return { ok: true }
      }

      // No method decorator: governed by the class limit of 1.
      @Get('/inherits')
      inherits(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({ controllers: [MCController] })
    class AppModule {}

    const app = await TestApp.create(AppModule).compile()

    // Override route: limit 3.
    const ro = await app.request('GET', '/mc/override', { ip: '7.7.7.7' })
    expect(ro.status).toBe(200)
    expect(ro.headers.get('RateLimit-Limit')).toBe('3')
    expect((await app.request('GET', '/mc/override', { ip: '7.7.7.7' })).status).toBe(200)
    expect((await app.request('GET', '/mc/override', { ip: '7.7.7.7' })).status).toBe(200)
    expect((await app.request('GET', '/mc/override', { ip: '7.7.7.7' })).status).toBe(429)

    // Inheriting route: class limit of 1.
    const ri = await app.request('GET', '/mc/inherits', { ip: '8.8.8.8' })
    expect(ri.status).toBe(200)
    expect(ri.headers.get('RateLimit-Limit')).toBe('1')
    expect((await app.request('GET', '/mc/inherits', { ip: '8.8.8.8' })).status).toBe(429)

    await app.close()
  })

  // ─── Skip combinations (skip wins over @RateLimit, stronger than specificity) ───

  it('@SkipRateLimit() + @RateLimit() on the same method -> no limiting at all', async () => {
    @Controller('/sk')
    class SkController {
      @Get('/both')
      @SkipRateLimit()
      @RateLimit({ limit: 1, window: '1m' })
      both(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({
      imports: [RateLimitModule.configure({ limit: 1, window: '1m' })],
      controllers: [SkController],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).useGuard(RateLimitGuard).compile()

    for (let i = 0; i < 5; i++) {
      expect((await app.request('GET', '/sk/both', { ip: '9.9.9.9' })).status).toBe(200)
    }

    await app.close()
  })

  it('decorator order is independent: @RateLimit above @SkipRateLimit also yields no limiting', async () => {
    @Controller('/ord')
    class OrdController {
      @Get('/both')
      @RateLimit({ limit: 1, window: '1m' })
      @SkipRateLimit()
      both(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({
      imports: [RateLimitModule.configure({ limit: 1, window: '1m' })],
      controllers: [OrdController],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).useGuard(RateLimitGuard).compile()

    for (let i = 0; i < 5; i++) {
      expect((await app.request('GET', '/ord/both', { ip: '10.10.10.10' })).status).toBe(200)
    }

    await app.close()
  })

  it('@SkipRateLimit() on a method under a class @RateLimit -> route unlimited, siblings stay limited', async () => {
    @Controller('/skc')
    @RateLimit({ limit: 1, window: '1m' })
    class SkcController {
      @Get('/free')
      @SkipRateLimit()
      free(_ctx: RequestContext) {
        return { ok: true }
      }

      @Get('/bound')
      bound(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({ controllers: [SkcController] })
    class AppModule {}

    const app = await TestApp.create(AppModule).compile()

    // Skipped route is never limited.
    for (let i = 0; i < 5; i++) {
      expect((await app.request('GET', '/skc/free', { ip: '11.11.11.11' })).status).toBe(200)
    }

    // Sibling route still under the class limit of 1.
    expect((await app.request('GET', '/skc/bound', { ip: '11.11.11.11' })).status).toBe(200)
    expect((await app.request('GET', '/skc/bound', { ip: '11.11.11.11' })).status).toBe(429)

    await app.close()
  })

  it('class @SkipRateLimit() wins over a method @RateLimit (skip is stronger than specificity)', async () => {
    @Controller('/csk')
    @SkipRateLimit()
    class CskController {
      // Method @RateLimit is gunned down by the class-level skip set, which
      // covers the method scope marker too.
      @Get('/m')
      @RateLimit({ limit: 1, window: '1m' })
      m(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({
      imports: [RateLimitModule.configure({ limit: 1, window: '1m' })],
      controllers: [CskController],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).useGuard(RateLimitGuard).compile()

    for (let i = 0; i < 5; i++) {
      expect((await app.request('GET', '/csk/m', { ip: '12.12.12.12' })).status).toBe(200)
    }

    await app.close()
  })

  // ─── Explicit @UseGuard(RateLimitGuard(policy)) still stacks with the global guard ───

  it('explicit @UseGuard(RateLimitGuard(policy)) without @RateLimit stacks with the global guard', async () => {
    @Controller('/stk')
    class StkController {
      // Advanced form: an explicit factory guard, no @RateLimit, no skip.
      // Both this guard (limit 5) and the global guard (limit 2) count.
      @Get('/')
      @UseGuard(RateLimitGuard({ limit: 5, window: '1m' }))
      hit(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({
      imports: [RateLimitModule.configure({ limit: 2, window: '1m' })],
      controllers: [StkController],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).useGuard(RateLimitGuard).compile()

    // The tighter of the two (the global limit of 2) wins because both stack.
    expect((await app.request('GET', '/stk/', { ip: '13.13.13.13' })).status).toBe(200)
    expect((await app.request('GET', '/stk/', { ip: '13.13.13.13' })).status).toBe(200)
    expect((await app.request('GET', '/stk/', { ip: '13.13.13.13' })).status).toBe(429)

    await app.close()
  })

  // ─── Headers reflect the local policy, not a stacked global one ───

  it('headers on a decorated route reflect the local policy', async () => {
    @Controller('/hdr')
    class HdrController {
      @Get('/')
      @RateLimit({ limit: 7, window: '1m' })
      hit(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({
      imports: [RateLimitModule.configure({ limit: 2, window: '1m' })],
      controllers: [HdrController],
    })
    class AppModule {}

    const app = await TestApp.create(AppModule).useGuard(RateLimitGuard).compile()

    const res = await app.request('GET', '/hdr/', { ip: '14.14.14.14' })
    expect(res.status).toBe(200)
    // The local policy (7), not the global (2), is what the client sees.
    expect(res.headers.get('RateLimit-Limit')).toBe('7')

    await app.close()
  })

  it('custom keyGenerator buckets by header, not ip', async () => {
    @Controller('/kg')
    class KgController {
      @Get('/')
      @RateLimit({
        limit: 1,
        window: '1m',
        keyGenerator: (ctx) => ctx.req.headers.get('x-client-id') ?? ctx.ip ?? 'unknown',
      })
      hit(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({ controllers: [KgController] })
    class AppModule {}

    const app = await TestApp.create(AppModule).compile()

    // First request for 'alice' passes.
    expect((await app.request('GET', '/kg/', { ip: '1.1.1.1', headers: { 'x-client-id': 'alice' } })).status).toBe(200)
    // Same client-id, different ip -> same bucket, blocked.
    expect((await app.request('GET', '/kg/', { ip: '2.2.2.2', headers: { 'x-client-id': 'alice' } })).status).toBe(429)
    // Different client-id -> fresh bucket.
    expect((await app.request('GET', '/kg/', { ip: '3.3.3.3', headers: { 'x-client-id': 'bob' } })).status).toBe(200)

    await app.close()
  })
})
