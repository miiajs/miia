import { describe, expect, it } from 'bun:test'
import type { CanActivate, RequestContext } from '../src/index.js'
import {
  Controller,
  Get,
  getMeta,
  Head,
  Miia,
  Module,
  NotFoundException,
  Post,
  RESOLVED_PREFIX,
  Router,
} from '../src/index.js'

const noop = (_ctx: RequestContext) => {}

function request(app: Miia, method: string, path: string, init?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, { method, ...init }))
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

// Each handler returns its own label, so a match says which route won.
function routes(...table: [string, string][]): Router {
  const router = new Router()
  for (const [method, path] of table) {
    router.add(method as 'GET', path, () => `${method} ${path}`)
  }
  return router
}

function matched(router: Router, method: string, path: string) {
  const result = router.match(method, path)
  return result && { route: result.handler({} as RequestContext), params: result.params }
}

describe('Backtracking', () => {
  it('should keep static > param > wildcard and fall back to the wildcard when the param branch dead-ends', () => {
    const router = routes(['GET', '/users/me'], ['GET', '/users/:id'], ['GET', '/users/*'])

    expect(matched(router, 'GET', '/users/me')).toEqual({ route: 'GET /users/me', params: {} })
    expect(matched(router, 'GET', '/users/42')).toEqual({ route: 'GET /users/:id', params: { id: '42' } })
    expect(matched(router, 'GET', '/users/42/posts/1')).toEqual({
      route: 'GET /users/*',
      params: { '*': '42/posts/1' },
    })
  })

  it('should fall back to the param branch when the static branch dead-ends', () => {
    const router = routes(['GET', '/users/me/settings'], ['GET', '/users/:id/posts'])

    expect(matched(router, 'GET', '/users/me/posts')).toEqual({ route: 'GET /users/:id/posts', params: { id: 'me' } })
    expect(matched(router, 'GET', '/users/me/settings')).toEqual({ route: 'GET /users/me/settings', params: {} })
  })

  it('should fall back when the path ends on a node that has no route', () => {
    const router = routes(['GET', '/users/:id/posts'], ['GET', '/users/*'])

    expect(matched(router, 'GET', '/users/42')).toEqual({ route: 'GET /users/*', params: { '*': '42' } })
  })

  it('should back up to a wildcard several levels above the dead end', () => {
    const router = routes(['GET', '/api/users/:id'], ['GET', '/api/*'])

    expect(matched(router, 'GET', '/api/users/42/unknown')).toEqual({
      route: 'GET /api/*',
      params: { '*': 'users/42/unknown' },
    })
    expect(matched(router, 'GET', '/api/users/42')).toEqual({ route: 'GET /api/users/:id', params: { id: '42' } })
  })

  it('should try the nearest lower-priority branch before a wildcard further up', () => {
    const router = routes(['GET', '/a/b/c/x'], ['GET', '/a/:p/c/y'], ['GET', '/a/*'])

    expect(matched(router, 'GET', '/a/b/c/y')).toEqual({ route: 'GET /a/:p/c/y', params: { p: 'b' } })
    expect(matched(router, 'GET', '/a/b/c/z')).toEqual({ route: 'GET /a/*', params: { '*': 'b/c/z' } })
  })

  it('should decide on the first segment that differs, not on the number of static segments', () => {
    const router = routes(['GET', '/a/b/:x'], ['GET', '/a/:y/c'])

    expect(matched(router, 'GET', '/a/b/c')).toEqual({ route: 'GET /a/b/:x', params: { x: 'c' } })
  })

  it('should not let a deeper route of another method block the fallback', () => {
    const router = routes(['POST', '/users/:id/avatar'], ['GET', '/users/:id'], ['GET', '/users/*'])

    expect(matched(router, 'GET', '/users/42/avatar')).toEqual({ route: 'GET /users/*', params: { '*': '42/avatar' } })
    expect(matched(router, 'POST', '/users/42/avatar')).toEqual({
      route: 'POST /users/:id/avatar',
      params: { id: '42' },
    })
    expect(matched(router, 'POST', '/users/42/other')).toBeNull()
  })

  it('should backtrack in the GET fallback of a HEAD request', () => {
    const router = routes(['GET', '/files/:id'], ['GET', '/files/*'])

    expect(matched(router, 'HEAD', '/files/a/b')).toEqual({ route: 'GET /files/*', params: { '*': 'a/b' } })
  })

  it('should search the HEAD routes before falling back to GET', () => {
    const router = routes(['HEAD', '/files/:id/meta'], ['GET', '/files/*'])

    expect(matched(router, 'HEAD', '/files/a/meta')).toEqual({ route: 'HEAD /files/:id/meta', params: { id: 'a' } })
    expect(matched(router, 'HEAD', '/files/a/b')).toEqual({ route: 'GET /files/*', params: { '*': 'a/b' } })
  })

  it('should still return null when no branch matches', () => {
    const router = routes(['GET', '/users/me/settings'], ['GET', '/users/:id/posts'])

    expect(router.match('GET', '/users/me/other')).toBeNull()
    expect(router.match('GET', '/users')).toBeNull()
    expect(router.match('GET', '/nope')).toBeNull()
  })

  it('should find the route a full search of a dense table picks', () => {
    // Every mix of `s` / `:pN` over 6 levels: each node has both a static and a param child.
    const table: [string, string][] = []
    for (let mask = 0; mask < 1 << 6; mask++) {
      const segs = Array.from({ length: 6 }, (_, l) => (mask & (1 << l) ? `:p${l}` : 's'))
      table.push(['GET', `/${segs.join('/')}/${mask === 0b101010 ? 'target' : 'end'}`])
    }
    const router = routes(...table)

    expect(matched(router, 'GET', '/s/s/s/s/s/s/target')).toEqual({
      route: 'GET /s/:p1/s/:p3/s/:p5/target',
      params: { p1: 's', p3: 's', p5: 's' },
    })
    expect(router.match('GET', '/s/s/s/s/s/s/miss')).toBeNull()
  })
})

describe('Param names per route', () => {
  it('should give each route its own names when routes share a param position', () => {
    const router = routes(['GET', '/users/:id'], ['GET', '/users/:userId/posts/:postId'])

    expect(matched(router, 'GET', '/users/42')!.params).toEqual({ id: '42' })
    expect(matched(router, 'GET', '/users/42/posts/7')!.params).toEqual({ userId: '42', postId: '7' })
  })

  it('should not depend on registration order', () => {
    const router = routes(['GET', '/u/:userId/posts'], ['GET', '/u/:id'])

    expect(matched(router, 'GET', '/u/1')!.params).toEqual({ id: '1' })
    expect(matched(router, 'GET', '/u/1/posts')!.params).toEqual({ userId: '1' })
  })

  it('should name the params of a wildcard route from its own pattern', () => {
    const router = routes(['GET', '/files/:id/meta'], ['GET', '/files/:name/*'])

    expect(matched(router, 'GET', '/files/a/b/c')).toEqual({
      route: 'GET /files/:name/*',
      params: { name: 'a', '*': 'b/c' },
    })
    expect(matched(router, 'GET', '/files/a/meta')!.params).toEqual({ id: 'a' })
  })

  it('should name the params of a route reached by backtracking', () => {
    const router = routes(['GET', '/a/:x/b/c'], ['GET', '/a/:y/*'])

    expect(matched(router, 'GET', '/a/1/b/d')).toEqual({ route: 'GET /a/:y/*', params: { y: '1', '*': 'b/d' } })
  })
})

describe('Backtracking through the app', () => {
  it('should give controller routes their own param names under module and global prefixes', async () => {
    @Controller('/users')
    class UsersController {
      @Get('/:id')
      findOne(ctx: RequestContext) {
        return ctx.params
      }

      @Get('/:userId/posts/:postId')
      getPost(ctx: RequestContext) {
        return ctx.params
      }

      @Get('/*')
      rest(ctx: RequestContext) {
        return { rest: ctx.params['*'] }
      }
    }

    @Module({ prefix: 'v1', controllers: [UsersController] })
    class V1Module {}

    const app = new Miia({ logger: false, globalPrefix: '/api' }).register(V1Module)

    expect(await (await request(app, 'GET', '/api/v1/users/42')).json()).toEqual({ id: '42' })
    expect(await (await request(app, 'GET', '/api/v1/users/42/posts/7')).json()).toEqual({ userId: '42', postId: '7' })
    expect(await (await request(app, 'GET', '/api/v1/users/42/likes')).json()).toEqual({ rest: '42/likes' })
  })

  it('should backtrack for HEAD through the GET fallback and keep explicit HEAD routes first', async () => {
    @Controller('/files')
    class FilesController {
      @Head('/:id/meta')
      meta(ctx: RequestContext) {
        ctx.res.header('x-route', 'head-meta')
      }

      @Get('/:id')
      one(ctx: RequestContext) {
        ctx.res.header('x-route', 'get-one')
      }

      @Get('/*')
      rest(ctx: RequestContext) {
        ctx.res.header('x-route', 'get-rest')
      }
    }

    @Module({ controllers: [FilesController] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)

    expect((await request(app, 'HEAD', '/files/a/meta')).headers.get('x-route')).toBe('head-meta')
    expect((await request(app, 'HEAD', '/files/a')).headers.get('x-route')).toBe('get-one')
    expect((await request(app, 'HEAD', '/files/a/b')).headers.get('x-route')).toBe('get-rest')
  })

  describe('a root wildcard next to a prefixed API', () => {
    @Controller('/users')
    class UsersController {
      @Get('/:id')
      findOne(ctx: RequestContext) {
        return { id: ctx.params.id }
      }

      @Post('/')
      create() {
        return { created: true }
      }
    }

    @Module({ controllers: [UsersController] })
    class AppModule {}

    // Stands in for serveStatic(app, '/', dist, { fallback, skipGlobalPrefix: true }).
    function withSpa(app: Miia): Miia {
      return app.addRoute(
        'GET',
        '/*',
        (ctx) => {
          ctx.res.html(`<title>spa</title>${ctx.params['*']}`)
        },
        { skipGlobalPrefix: true, skipGlobalGuards: true },
      )
    }

    it('should let an unknown API path fall through to the root wildcard', async () => {
      const app = withSpa(new Miia({ logger: false, globalPrefix: '/api' }).register(AppModule))

      const unknown = await request(app, 'GET', '/api/nope')
      expect(unknown.status).toBe(200)
      expect(await unknown.text()).toBe('<title>spa</title>api/nope')

      const deadEnd = await request(app, 'GET', '/api/users/42/nope')
      expect(await deadEnd.text()).toBe('<title>spa</title>api/users/42/nope')

      expect(await (await request(app, 'GET', '/api/users/42')).json()).toEqual({ id: '42' })
      expect((await request(app, 'POST', '/api/nope')).status).toBe(404)
    })

    it('should keep unknown API paths a plain 404 with a catch-all under the prefix', async () => {
      class RequireToken implements CanActivate {
        canActivate(ctx: RequestContext) {
          return ctx.req.headers.has('authorization')
        }
      }

      const app = withSpa(new Miia({ logger: false, globalPrefix: '/api' }).register(AppModule))
      app.useGuard(RequireToken)
      app.addRoute(
        'GET',
        '/*',
        () => {
          throw new NotFoundException()
        },
        { skipGlobalGuards: true },
      )

      for (const path of ['/api', '/api/nope', '/api/users/42/nope']) {
        const res = await request(app, 'GET', path)
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Not Found' })
        expect((await request(app, 'HEAD', path)).status).toBe(404)
      }

      const authorized = { headers: { authorization: 'Bearer t' } }
      expect((await request(app, 'GET', '/api/users/42')).status).toBe(403)
      expect(await (await request(app, 'GET', '/api/users/42', authorized)).json()).toEqual({ id: '42' })
      expect((await request(app, 'POST', '/api/users', authorized)).status).toBe(200)
      expect(await (await request(app, 'GET', '/about')).text()).toBe('<title>spa</title>about')
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
    await app.init()

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

describe('Duplicate routes', () => {
  function thrownBy(fn: () => unknown): Error {
    try {
      fn()
    } catch (err) {
      return err as Error
    }
    throw new Error('expected a throw')
  }

  it('should reject the same method and path registered twice', () => {
    const app = new Miia({ logger: false })
    app.addRoute('GET', '/x', noop)

    const err = thrownBy(() => app.addRoute('GET', '/x/', noop))
    expect(err.message).toBe('[Miia] Route GET /x conflicts with GET /x')
    expect(err.constructor).toBe(Error)
  })

  it('should reject a param route that differs only in the param name, naming both patterns', () => {
    const router = new Router()
    router.add('GET', '/u/:id', noop)

    expect(() => router.add('GET', '/u/:userId', noop)).toThrow('[Miia] Route GET /u/:userId conflicts with GET /u/:id')
  })

  it('should reject a second wildcard on the same prefix', () => {
    const router = new Router()
    router.add('GET', '/files/*', noop)

    expect(() => router.add('GET', '/files/*', noop)).toThrow('[Miia] Route GET /files/* conflicts with GET /files/*')
  })

  it('should reject a wildcard route that differs only in the param name before it', () => {
    const router = new Router()
    router.add('GET', '/u/:id/*', noop)

    expect(() => router.add('GET', '/u/:other/*', noop)).toThrow(
      '[Miia] Route GET /u/:other/* conflicts with GET /u/:id/*',
    )
  })

  it('should accept different param names on one path for different methods, each with its own', () => {
    const router = routes(['GET', '/u/:id'], ['POST', '/u/:userId'], ['HEAD', '/u/:key'])

    expect(matched(router, 'GET', '/u/1')!.params).toEqual({ id: '1' })
    expect(matched(router, 'POST', '/u/1')!.params).toEqual({ userId: '1' })
    expect(matched(router, 'HEAD', '/u/1')!.params).toEqual({ key: '1' })
  })

  it('should reject a controller route that lands on an addRoute() path', async () => {
    @Controller('/users')
    class UsersController {
      @Get('/')
      list(_ctx: RequestContext) {
        return { ok: true }
      }
    }

    @Module({ controllers: [UsersController] })
    class AppModule {}

    // Collisions exist only after normalization: the controller lands under the global prefix,
    // the addRoute() path carries it literally.
    const app = new Miia({ logger: false, globalPrefix: '/api' }).register(AppModule)
    app.addRoute('GET', '/api/users', noop, { skipGlobalPrefix: true })

    await expect(app.init()).rejects.toThrow('[Miia] Route GET /api/users conflicts with GET /api/users')
  })

  it('should allow GET and HEAD on the same path', () => {
    const router = new Router()
    router.add('GET', '/x', () => 'get')
    router.add('HEAD', '/x', () => 'head')
    router.add('GET', '/u/:id', () => 'get')
    router.add('HEAD', '/u/:id', () => 'head')

    expect(router.match('GET', '/x')!.handler({} as RequestContext)).toBe('get')
    expect(router.match('HEAD', '/x')!.handler({} as RequestContext)).toBe('head')
    expect(router.match('HEAD', '/u/1')!.handler({} as RequestContext)).toBe('head')
  })

  it('should leave the router untouched when a route is rejected', () => {
    const router = new Router()
    router.add('POST', '/upload', noop)
    const ceiling = router.adapterBodyCeiling

    expect(() => router.add('POST', '/upload', noop, { bodyLimit: 50 * 1024 * 1024 })).toThrow(/conflicts with/)
    expect(router.adapterBodyCeiling).toBe(ceiling)
  })
})

describe('Relative request url', () => {
  // Bun gives a request with an invalid Host (`x/y`, `x?q`, empty) a url without scheme and host
  function relative(app: Miia, url: string) {
    return app.fetch({ method: 'GET', url, headers: new Headers() } as Request)
  }

  it('routes by the whole path, not past its first segment', async () => {
    const app = new Miia({ logger: false })
    app.addRoute('GET', '/admin/x', () => 'ADMIN')
    app.addRoute('GET', '/foo/admin/x', () => 'FOO')
    await app.init()
    expect(await (await relative(app, '/foo/admin/x')).json()).toBe('FOO')
    expect(await (await relative(app, '/foo/admin/x?q=1')).json()).toBe('FOO')
    expect((await relative(app, '/x//admin/x')).status).toBe(404)
    expect(await (await request(app, 'GET', '/foo/admin/x')).json()).toBe('FOO')
  })
})
