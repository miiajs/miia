import { describe, expect, it } from 'bun:test'
import type { RequestContext } from '../src/index.js'
import { Controller, Get, getMeta, Miia, Module, RESOLVED_PREFIX, Router } from '../src/index.js'

const noop = (_ctx: RequestContext) => {}

function request(app: Miia, method: string, path: string) {
  return app.fetch(new Request(`http://localhost${path}`, { method }))
}

describe('Router', () => {
  describe('exact match', () => {
    it('should match root path', () => {
      const router = new Router()
      router.add('GET', '/', noop)

      const result = router.match('GET', '/')
      expect(result).not.toBeNull()
      expect(result!.params).toEqual({})
    })

    it('should match simple path', () => {
      const router = new Router()
      router.add('GET', '/users', noop)

      expect(router.match('GET', '/users')).not.toBeNull()
      expect(router.match('GET', '/posts')).toBeNull()
    })

    it('should match nested path', () => {
      const router = new Router()
      router.add('GET', '/api/v1/users', noop)

      expect(router.match('GET', '/api/v1/users')).not.toBeNull()
      expect(router.match('GET', '/api/v1')).toBeNull()
    })
  })

  describe('named params', () => {
    it('should extract single param', () => {
      const router = new Router()
      router.add('GET', '/users/:id', noop)

      const result = router.match('GET', '/users/42')
      expect(result).not.toBeNull()
      expect(result!.params).toEqual({ id: '42' })
    })

    it('should extract multiple params', () => {
      const router = new Router()
      router.add('GET', '/users/:userId/posts/:postId', noop)

      const result = router.match('GET', '/users/5/posts/10')
      expect(result).not.toBeNull()
      expect(result!.params).toEqual({ userId: '5', postId: '10' })
    })
  })

  describe('wildcard', () => {
    it('should match wildcard and capture rest', () => {
      const router = new Router()
      router.add('GET', '/files/*', noop)

      const result = router.match('GET', '/files/docs/readme.md')
      expect(result).not.toBeNull()
      expect(result!.params).toEqual({ '*': 'docs/readme.md' })
    })

    it('should match wildcard with empty rest', () => {
      const router = new Router()
      router.add('GET', '/files/*', noop)

      const result = router.match('GET', '/files/')
      expect(result).not.toBeNull()
      expect(result!.params).toEqual({ '*': '' })
    })
  })

  describe('method filtering', () => {
    it('should not match wrong method', () => {
      const router = new Router()
      router.add('POST', '/users', noop)

      expect(router.match('GET', '/users')).toBeNull()
      expect(router.match('POST', '/users')).not.toBeNull()
    })

    it('should match correct handler per method', () => {
      const router = new Router()
      const getHandler = (_ctx: RequestContext) => 'get'
      const postHandler = (_ctx: RequestContext) => 'post'

      router.add('GET', '/items', getHandler)
      router.add('POST', '/items', postHandler)

      expect(router.match('GET', '/items')!.handler).toBe(getHandler)
      expect(router.match('POST', '/items')!.handler).toBe(postHandler)
    })
  })

  describe('trailing slashes', () => {
    it('should normalize trailing slashes', () => {
      const router = new Router()
      router.add('GET', '/users/', noop)

      expect(router.match('GET', '/users')).not.toBeNull()
      expect(router.match('GET', '/users/')).not.toBeNull()
    })
  })

  describe('route middlewares', () => {
    it('should compile route-level middlewares into pipeline', () => {
      const router = new Router()
      const mw = async () => {}
      router.add('GET', '/test', noop, { middlewares: [mw as any] })
      router.compileAll([])

      const result = router.match('GET', '/test')
      expect(result!.compiledPipeline).toBeDefined()
    })
  })

  describe('HEAD fallback', () => {
    it('should match HEAD against GET routes when no explicit HEAD route', () => {
      const router = new Router()
      const handler = (_ctx: RequestContext) => 'get-handler'
      router.add('GET', '/users', handler)

      const result = router.match('HEAD', '/users')
      expect(result).not.toBeNull()
      expect(result!.handler).toBe(handler)
    })

    it('should prefer explicit HEAD route over GET fallback', () => {
      const router = new Router()
      const getHandler = (_ctx: RequestContext) => 'get'
      const headHandler = (_ctx: RequestContext) => 'head'
      router.add('GET', '/users', getHandler)
      router.add('HEAD', '/users', headHandler)

      const result = router.match('HEAD', '/users')
      expect(result).not.toBeNull()
      expect(result!.handler).toBe(headHandler)
    })

    it('should return null for HEAD when no GET route either', () => {
      const router = new Router()
      router.add('POST', '/users', noop)

      expect(router.match('HEAD', '/users')).toBeNull()
    })
  })

  describe('OPTIONS', () => {
    it('should match OPTIONS route', () => {
      const router = new Router()
      const handler = (_ctx: RequestContext) => 'options'
      router.add('OPTIONS', '/users', handler)

      const result = router.match('OPTIONS', '/users')
      expect(result).not.toBeNull()
      expect(result!.handler).toBe(handler)
    })
  })
})

describe('Global prefix', () => {
  it('should prefix controller routes when set via the constructor option', async () => {
    @Controller('/users')
    class UsersController {
      @Get('/')
      list(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({ controllers: [UsersController] })
    class AppModule {}

    const app = new Miia({ logger: false, globalPrefix: '/api' }).register(AppModule)

    expect((await request(app, 'GET', '/api/users')).status).toBe(200)
    expect((await request(app, 'GET', '/users')).status).toBe(404)
  })

  it('should treat bare, leading-slash and trailing-slash forms as the same prefix', () => {
    for (const prefix of ['api', '/api', '/api/']) {
      const router = new Router()
      router.globalPrefix = prefix
      router.add('GET', '/users', noop)

      expect(router.globalPrefix).toBe('api')
      expect(router.match('GET', '/api/users')).not.toBeNull()
      expect(router.match('GET', '/users')).toBeNull()
    }
  })

  it('should compose with module and controller prefixes', async () => {
    @Controller('/users')
    class UsersController {
      @Get('/')
      list(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({ prefix: 'v1', controllers: [UsersController] })
    class V1Module {}

    @Module({ imports: [V1Module] })
    class AppModule {}

    const app = new Miia({ logger: false, globalPrefix: '/api' }).register(AppModule)

    expect((await request(app, 'GET', '/api/v1/users')).status).toBe(200)
    expect((await request(app, 'GET', '/v1/users')).status).toBe(404)
  })

  it('should keep named params and wildcards intact under the prefix', async () => {
    @Controller('/users')
    class UsersController {
      @Get('/:id')
      findOne(ctx: RequestContext) {
        return { id: ctx.params.id }
      }
    }

    @Controller('/files')
    class FilesController {
      @Get('/*')
      serve(ctx: RequestContext) {
        return { path: ctx.params['*'] }
      }
    }

    @Module({ controllers: [UsersController, FilesController] })
    class AppModule {}

    const app = new Miia({ logger: false, globalPrefix: '/api' }).register(AppModule)

    const byId = await request(app, 'GET', '/api/users/42')
    expect(byId.status).toBe(200)
    expect(await byId.json()).toEqual({ id: '42' })

    const file = await request(app, 'GET', '/api/files/docs/readme.md')
    expect(file.status).toBe(200)
    expect(await file.json()).toEqual({ path: 'docs/readme.md' })
  })

  it('should prefix routes registered with addRoute()', async () => {
    const app = new Miia({ logger: false, globalPrefix: '/api' })
    app.addRoute('GET', '/health', (_ctx: RequestContext) => ({ status: 'ok' }))
    app.addRoute('GET', '/', (_ctx: RequestContext) => ({ root: true }))

    expect((await request(app, 'GET', '/api/health')).status).toBe(200)
    expect((await request(app, 'GET', '/health')).status).toBe(404)

    const root = await request(app, 'GET', '/api')
    expect(root.status).toBe(200)
    expect(await root.json()).toEqual({ root: true })
  })

  it('should throw when the prefix is set after a route is registered', () => {
    @Controller('/users')
    class UsersController {
      @Get('/')
      list(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({ controllers: [UsersController] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)

    const assign = () => {
      app.get(Router).globalPrefix = '/api'
    }

    expect(assign).toThrow(/before any route is registered/)
    // Plain Error, not TypeError - that one is reserved for bad characters.
    // toThrow(Error) would pass for a TypeError too, so pin the name.
    let thrown: unknown
    try {
      assign()
    } catch (err) {
      thrown = err
    }
    expect((thrown as Error).constructor).toBe(Error)
    expect((thrown as Error).name).toBe('Error')
  })

  it('should reject prefixes containing routing or URL-significant characters', () => {
    for (const bad of ['*', '/api/*', '/:version', '/api?v=1', '/api#frag', '/api v1']) {
      expect(() => new Miia({ logger: false, globalPrefix: bad })).toThrow(TypeError)
    }
  })

  it('should treat "/" as no prefix at all', async () => {
    @Controller('/users')
    class UsersController {
      @Get('/')
      list(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({ controllers: [UsersController] })
    class AppModule {}

    const app = new Miia({ logger: false, globalPrefix: '/' }).register(AppModule)

    expect(app.get(Router).globalPrefix).toBe('')
    expect((await request(app, 'GET', '/users')).status).toBe(200)
  })

  it('should expose the normalized prefix from the getter', () => {
    const router = new Router()
    expect(router.globalPrefix).toBe('')

    router.globalPrefix = '/api/v1/'
    expect(router.globalPrefix).toBe('api/v1')
  })

  it('should not leak the prefix into RESOLVED_PREFIX', async () => {
    @Controller('/users')
    class UsersController {
      @Get('/')
      list(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({ prefix: 'v1', controllers: [UsersController] })
    class V1Module {}

    @Module({ imports: [V1Module] })
    class AppModule {}

    const app = new Miia({ logger: false, globalPrefix: '/api' }).register(AppModule)

    expect(getMeta<string>(UsersController, RESOLVED_PREFIX)).toBe('v1/users')
    expect((await request(app, 'GET', '/api/v1/users')).status).toBe(200)
  })

  it('should leave addRoute() calls passing skipGlobalPrefix at their literal path', async () => {
    const app = new Miia({ logger: false, globalPrefix: '/api' })
    app.addRoute('GET', '/health', (_ctx: RequestContext) => ({ status: 'ok' }), { skipGlobalPrefix: true })

    expect((await request(app, 'GET', '/health')).status).toBe(200)
    expect((await request(app, 'GET', '/api/health')).status).toBe(404)
  })

  it('should keep addRoute() routes carrying middlewares prefixed and running their middleware', async () => {
    const seen: string[] = []
    const app = new Miia({ logger: false, globalPrefix: '/api' })
    app.addRoute('GET', '/x', (_ctx: RequestContext) => ({ ok: true }), {
      middlewares: [
        async (_ctx, next) => {
          seen.push('mw')
          await next()
        },
      ],
    })

    expect((await request(app, 'GET', '/api/x')).status).toBe(200)
    expect((await request(app, 'GET', '/x')).status).toBe(404)
    expect(seen).toEqual(['mw'])
  })

  it('should leave routes added with skipGlobalPrefix unprefixed', () => {
    const router = new Router()
    router.globalPrefix = '/api'
    router.add('GET', '/docs/json', noop, { skipGlobalPrefix: true })
    router.add('GET', '/users', noop)

    expect(router.match('GET', '/docs/json')).not.toBeNull()
    expect(router.match('GET', '/api/docs/json')).toBeNull()
    expect(router.match('GET', '/api/users')).not.toBeNull()
  })
})
