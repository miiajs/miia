import { describe, expect, it } from 'bun:test'
import type { CanActivate, Middleware, RequestContext } from '../src/index.js'
import { Controller, createToken, Get, inject, Injectable, Miia, Module } from '../src/index.js'

function get(app: Miia, path: string, headers?: Record<string, string>): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`http://localhost${path}`, { headers })))
}

function thrownBy(fn: () => unknown): Error {
  try {
    fn()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected a throw')
}

class AllowAll implements CanActivate {
  canActivate() {
    return true
  }
}

function makeFeature() {
  @Injectable()
  class GreetingService {
    greet() {
      return 'hello'
    }
  }

  @Module({ global: true, providers: [GreetingService], exports: [GreetingService] })
  class OtherModule {}

  @Controller('/greet')
  class GreetController {
    private greeting = inject(GreetingService)

    @Get('/')
    greet(_ctx: RequestContext) {
      return { text: this.greeting.greet() }
    }
  }

  @Module({ controllers: [GreetController] })
  class FeatureModule {}

  return { GreetingService, OtherModule, FeatureModule }
}

describe('module graph', () => {
  it('does not depend on the order of separate register() calls', async () => {
    for (const order of ['feature-first', 'other-first'] as const) {
      const { OtherModule, FeatureModule } = makeFeature()
      const app = new Miia({ logger: false })
      if (order === 'feature-first') app.register(FeatureModule).register(OtherModule)
      else app.register(OtherModule).register(FeatureModule)

      const res = await get(app, '/greet')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ text: 'hello' })
    }
  })

  it('is processed by the first app.get()', () => {
    const { GreetingService, OtherModule } = makeFeature()
    const app = new Miia({ logger: false }).register(OtherModule)

    expect(app.get(GreetingService).greet()).toBe('hello')
  })

  it('rejects register() and provide() once processed', async () => {
    const { GreetingService, OtherModule, FeatureModule } = makeFeature()

    const afterGet = new Miia({ logger: false }).register(OtherModule)
    afterGet.get(GreetingService)
    const late = thrownBy(() => afterGet.register(FeatureModule))
    expect(late.message).toBe(
      '[Miia] register() after the module graph was processed (first init(), app.get() or fetch()) - ' +
        'register all modules and providers before that',
    )
    expect(late.constructor).toBe(Error)

    const lateProvide = thrownBy(() => afterGet.provide({ token: createToken('X'), factory: () => 1 }))
    expect(lateProvide.message).toStartWith('[Miia] provide() after the module graph was processed')
    expect(lateProvide.constructor).toBe(Error)

    const afterInit = new Miia({ logger: false }).register(OtherModule)
    await afterInit.init()
    expect(() => afterInit.register(FeatureModule)).toThrow('[Miia] register() after the module graph was processed')

    const afterFetch = new Miia({ logger: false }).register(OtherModule)
    await get(afterFetch, '/nothing')
    expect(() => afterFetch.provide({ token: createToken('X'), factory: () => 1 })).toThrow(
      '[Miia] provide() after the module graph was processed',
    )
  })

  it('rethrows the first error on every later access', async () => {
    @Injectable()
    class SharedService {}

    @Module({ providers: [SharedService] })
    class ModuleA {}

    @Module({ providers: [SharedService] })
    class ModuleB {}

    const app = new Miia({ logger: false }).register(ModuleA, ModuleB)

    const first = thrownBy(() => app.get(SharedService))
    expect(first.message).toStartWith('[Miia] SharedService is provided by both ModuleA and ModuleB')

    expect(thrownBy(() => app.get(SharedService))).toBe(first)
    await expect(app.init()).rejects.toBe(first)

    const late = thrownBy(() => app.register(ModuleA))
    expect(late.message).toBe('[Miia] register() after the module graph failed to process (see the first error)')
    expect(late.constructor).toBe(Error)
  })
})

describe('app configuration after init()', () => {
  it('rejects use(), useGuard() and addRoute() once init() has started', async () => {
    const app = new Miia({ logger: false })
    await app.init()

    const cases: Array<[string, () => unknown]> = [
      ['use', () => app.use(async (_ctx, next) => next())],
      ['useGuard', () => app.useGuard(AllowAll)],
      ['addRoute', () => app.addRoute('GET', '/late', () => ({}))],
    ]
    for (const [method, call] of cases) {
      const err = thrownBy(call)
      expect(err.message).toBe(`[Miia] ${method}() after init() - configure the app before init()/listen()`)
      expect(err.constructor).toBe(Error)
    }
  })

  it('rejects a call made while init() is still running its hooks', async () => {
    let app!: Miia
    let caught: unknown

    @Injectable()
    class EagerService {
      async onInit() {
        try {
          app.use(async (_ctx, next) => next())
        } catch (err) {
          caught = err
        }
      }
    }

    @Module({ providers: [EagerService] })
    class AppModule {}

    app = new Miia({ logger: false }).register(AppModule)
    await app.init()

    expect((caught as Error).message).toBe('[Miia] use() after init() - configure the app before init()/listen()')
  })

  it('accepts use(), useGuard() and addRoute() between app.get() and init()', async () => {
    const { GreetingService, OtherModule, FeatureModule } = makeFeature()
    const app = new Miia({ logger: false }).register(OtherModule, FeatureModule)

    app.get(GreetingService)

    class HeaderGuard implements CanActivate {
      canActivate(ctx: RequestContext) {
        return ctx.req.headers.get('x-pass') === '1'
      }
    }
    const tag: Middleware = async (ctx, next) => {
      ctx.res.header('X-Tag', 'on')
      await next()
    }

    app.useGuard(HeaderGuard)
    app.use(tag)
    app.addRoute('GET', '/health', () => ({ ok: true }))
    await app.init()

    const blocked = await get(app, '/greet')
    expect(blocked.status).toBe(403)

    const greet = await get(app, '/greet', { 'x-pass': '1' })
    expect(greet.status).toBe(200)
    expect(greet.headers.get('X-Tag')).toBe('on')

    expect((await get(app, '/health', { 'x-pass': '1' })).status).toBe(200)
  })
})
