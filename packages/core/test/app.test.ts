import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { CanActivate, Middleware, RequestContext, ZodLike } from '../src/index.js'
import {
  Controller,
  cors,
  ForbiddenException,
  Get,
  inject,
  Injectable,
  Miia,
  Module,
  NotFoundException,
  Post,
  SkipGuard,
  Status,
  UnauthorizedException,
  Use,
  UseGuard,
  ValidateBody,
  GUARD_FACTORY,
} from '../src/index.js'

// Helper to make requests to the app
async function request(
  app: Miia,
  method: string,
  path: string,
  options: { body?: any; headers?: Record<string, string> } = {},
) {
  const init: RequestInit = { method, headers: options.headers }
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
    init.headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    }
  }
  const req = new Request(`http://localhost${path}`, init)
  return app.fetch(req)
}

describe('Miia Application', () => {
  describe('basic routing', () => {
    it('should handle a simple GET route', async () => {
      @Controller('/hello')
      class HelloController {
        @Get('/')
        greet(_ctx: RequestContext) {
          return { message: 'Hello, World!' }
        }
      }

      @Module({ controllers: [HelloController] })
      class AppModule {}

      const app = new Miia().register(AppModule)
      const res = await request(app, 'GET', '/hello/')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ message: 'Hello, World!' })
    })

    it('should return 404 for unknown route', async () => {
      @Module({ controllers: [] })
      class EmptyModule {}

      const app = new Miia().register(EmptyModule)
      const res = await request(app, 'GET', '/nonexistent')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Cannot GET /nonexistent' })
    })

    it('should extract params from URL', async () => {
      @Controller('/users')
      class UserCtrl {
        @Get('/:id')
        getUser(ctx: RequestContext) {
          return { id: ctx.params.id }
        }
      }

      @Module({ controllers: [UserCtrl] })
      class M {}

      const app = new Miia().register(M)
      const res = await request(app, 'GET', '/users/42')
      expect(await res.json()).toEqual({ id: '42' })
    })

    it('should extract query params', async () => {
      @Controller('/search')
      class SearchCtrl {
        @Get('/')
        search(ctx: RequestContext) {
          return { q: ctx.query.q, page: ctx.query.page }
        }
      }

      @Module({ controllers: [SearchCtrl] })
      class M {}

      const app = new Miia().register(M)
      const res = await request(app, 'GET', '/search/?q=test&page=2')
      expect(await res.json()).toEqual({ q: 'test', page: '2' })
    })
  })

  describe('module system', () => {
    it('should support nested module imports with prefixes', async () => {
      @Controller('/items')
      class ItemCtrl {
        @Get('/')
        list(_ctx: RequestContext) {
          return [{ id: 1 }]
        }
      }

      @Module({ controllers: [ItemCtrl], prefix: '/v1' })
      class ItemModule {}

      @Module({ imports: [ItemModule], prefix: '/api' })
      class AppModule {}

      const app = new Miia().register(AppModule)
      const res = await request(app, 'GET', '/api/v1/items/')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([{ id: 1 }])
    })

    it('should register providers via factory', async () => {
      @Controller('/test')
      class TestCtrl {
        private val = inject<string>('MY_TOKEN')

        @Get('/')
        handler(_ctx: RequestContext) {
          return { value: this.val }
        }
      }

      @Module({
        controllers: [TestCtrl],
        providers: [{ token: 'MY_TOKEN', factory: () => 'hello-factory' }],
      })
      class M {}

      const app = new Miia().register(M)
      const res = await request(app, 'GET', '/test/')
      expect(await res.json()).toEqual({ value: 'hello-factory' })
    })
  })

  describe('middleware', () => {
    it('should execute global middleware', async () => {
      const order: string[] = []

      const trackingMw: Middleware = async (_ctx, next) => {
        order.push('global')
        await next()
      }

      @Controller('/')
      class Ctrl {
        @Get('/')
        handler(_ctx: RequestContext) {
          order.push('handler')
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia().use(trackingMw).register(M)
      await request(app, 'GET', '/')
      expect(order).toEqual(['global', 'handler'])
    })
  })

  describe('@Status decorator', () => {
    it('should set custom response status', async () => {
      @Controller('/items')
      class Ctrl {
        @Post('/')
        @Status(201)
        create(_ctx: RequestContext) {
          return { id: 1 }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia().register(M)
      const res = await request(app, 'POST', '/items/')
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ id: 1 })
    })
  })

  describe('error handling', () => {
    it('should catch HttpException and return proper JSON', async () => {
      @Controller('/')
      class Ctrl {
        @Get('/fail')
        handler(_ctx: RequestContext) {
          throw new NotFoundException('Resource not found')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia().register(M)
      const res = await request(app, 'GET', '/fail')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Resource not found' })
    })

    it('should handle unknown errors as 500', async () => {
      @Controller('/')
      class Ctrl {
        @Get('/boom')
        handler(_ctx: RequestContext) {
          throw new Error('unexpected')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia().register(M)
      const res = await request(app, 'GET', '/boom')
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal Server Error',
      })
    })
  })

  describe('error response headers', () => {
    // Global middleware is composed into a pre-route pipeline that wraps the
    // entire dispatch (including router.match). NotFoundException bubbles up
    // through the onion, so CORS headers set by global middleware DO appear on
    // 404 responses. This is the key correctness property of pre-route globals.
    it('preserves global middleware headers on unmatched route', async () => {
      @Module({ controllers: [] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(cors({ origin: '*' }))
      const res = await request(app, 'GET', '/nope', { headers: { Origin: 'https://example.com' } })
      expect(res.status).toBe(404)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('preserves middleware header through HttpException', async () => {
      const addRequestId: Middleware = async (ctx, next) => {
        ctx.res.header('X-Request-Id', 'abc-123')
        await next()
      }

      @Controller('/')
      @Use(addRequestId)
      class Ctrl {
        @Get('/denied')
        handler(_ctx: RequestContext) {
          throw new UnauthorizedException('nope')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/denied')
      expect(res.status).toBe(401)
      expect(res.headers.get('x-request-id')).toBe('abc-123')
    })

    it('preserves middleware header through unhandled error', async () => {
      const addRequestId: Middleware = async (ctx, next) => {
        ctx.res.header('X-Request-Id', 'abc-123')
        await next()
      }

      @Controller('/')
      @Use(addRequestId)
      class Ctrl {
        @Get('/kaboom')
        handler(_ctx: RequestContext) {
          throw new Error('kaboom')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/kaboom')
      expect(res.status).toBe(500)
      expect(res.headers.get('x-request-id')).toBe('abc-123')
      expect(await res.json()).toEqual({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal Server Error',
      })
    })

    it('preserves headers when the async pipeline rejects', async () => {
      const addRequestId: Middleware = async (ctx, next) => {
        ctx.res.header('X-Request-Id', 'async-1')
        await next()
      }

      @Controller('/')
      @Use(addRequestId)
      class Ctrl {
        @Get('/async-fail')
        async handler(_ctx: RequestContext) {
          return Promise.reject(new NotFoundException('gone'))
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/async-fail')
      expect(res.status).toBe(404)
      expect(res.headers.get('x-request-id')).toBe('async-1')
    })

    it('does not leak a stale middleware-set Content-Length into the error response', async () => {
      const setStaleLength: Middleware = async (ctx, next) => {
        ctx.res.header('Content-Length', '999')
        await next()
      }

      @Controller('/')
      @Use(setStaleLength)
      class Ctrl {
        @Get('/fail')
        handler(_ctx: RequestContext) {
          throw new NotFoundException('nope')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/fail')
      expect(res.status).toBe(404)
      expect(res.headers.get('content-length')).not.toBe('999')
      expect(await res.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'nope' })
    })

    it('strips a stale middleware-set Content-Encoding from the error response', async () => {
      const setStaleEncoding: Middleware = async (ctx, next) => {
        ctx.res.header('Content-Encoding', 'gzip')
        await next()
      }

      @Controller('/')
      @Use(setStaleEncoding)
      class Ctrl {
        @Get('/fail')
        handler(_ctx: RequestContext) {
          throw new NotFoundException('nope')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/fail')
      expect(res.headers.get('content-encoding')).toBeNull()
    })

    it('returns empty body for HEAD on matched route that throws', async () => {
      @Controller('/')
      class Ctrl {
        @Get('/boom')
        handler(_ctx: RequestContext) {
          throw new NotFoundException('nope')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'HEAD', '/boom')
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('')
    })

    it('returns empty body for HEAD on unmatched route', async () => {
      @Module({ controllers: [] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'HEAD', '/definitely-nope')
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('')
    })

    it('forces Content-Type to application/json even when middleware set text/html', async () => {
      const setHtml: Middleware = async (ctx, next) => {
        ctx.res.header('Content-Type', 'text/html')
        await next()
      }

      @Controller('/')
      @Use(setHtml)
      class Ctrl {
        @Get('/fail')
        handler(_ctx: RequestContext) {
          throw new NotFoundException('nope')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/fail')
      expect(res.headers.get('content-type')).toBe('application/json')
    })

    it('preserves CORS headers on thrown ForbiddenException (main fix scenario)', async () => {
      @Controller('/')
      class Ctrl {
        @Get('/forbidden')
        handler(_ctx: RequestContext) {
          throw new ForbiddenException('nope')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(cors({ origin: '*' }))
      const res = await request(app, 'GET', '/forbidden', { headers: { Origin: 'https://example.com' } })
      expect(res.status).toBe(403)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('preserves Set-Cookie from middleware on error response', async () => {
      const setCookie: Middleware = async (ctx, next) => {
        ctx.res.header('Set-Cookie', 'sid=xyz')
        await next()
      }

      @Controller('/')
      @Use(setCookie)
      class Ctrl {
        @Get('/fail')
        handler(_ctx: RequestContext) {
          throw new NotFoundException('nope')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/fail')
      expect(res.headers.getSetCookie()).toContain('sid=xyz')
    })
  })

  describe('pre-route global middleware', () => {
    it('observes 404 responses in middleware (requestLogger scenario)', async () => {
      const observed: { status?: number; error?: unknown }[] = []
      const requestLogger: Middleware = async (ctx, next) => {
        try {
          await next()
          observed.push({ status: ctx.res.getStatus() })
        } catch (err) {
          observed.push({ error: err })
          throw err
        }
      }

      @Module({ controllers: [] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(requestLogger)
      const res = await request(app, 'GET', '/missing')
      expect(res.status).toBe(404)
      expect(observed).toHaveLength(1)
      expect(observed[0].error).toBeInstanceOf(NotFoundException)
    })

    it('injects X-Request-Id header on 404 via global middleware', async () => {
      const requestId: Middleware = async (ctx, next) => {
        ctx.res.header('X-Request-Id', 'req-42')
        await next()
      }

      @Module({ controllers: [] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(requestId)
      const res = await request(app, 'GET', '/nowhere')
      expect(res.status).toBe(404)
      expect(res.headers.get('x-request-id')).toBe('req-42')
    })

    it('middleware can catch and transform NotFoundException', async () => {
      const catchAll: Middleware = async (ctx, next) => {
        try {
          await next()
        } catch (err) {
          if (err instanceof NotFoundException) {
            ctx.res.status(404).json({ custom: true, message: err.message })
            return
          }
          throw err
        }
      }

      @Module({ controllers: [] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(catchAll)
      const res = await request(app, 'GET', '/nothing')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ custom: true, message: 'Cannot GET /nothing' })
    })

    it('onion order: global outer → per-route inner → handler', async () => {
      const trace: string[] = []
      const globalMw: Middleware = async (_ctx, next) => {
        trace.push('global-before')
        await next()
        trace.push('global-after')
      }
      const routeMw: Middleware = async (_ctx, next) => {
        trace.push('route-before')
        await next()
        trace.push('route-after')
      }

      @Controller('/')
      @Use(routeMw)
      class Ctrl {
        @Get('/ping')
        handler(_ctx: RequestContext) {
          trace.push('handler')
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(globalMw)
      const res = await request(app, 'GET', '/ping')
      expect(res.status).toBe(200)
      expect(trace).toEqual(['global-before', 'route-before', 'handler', 'route-after', 'global-after'])
    })

    it('sync fast path preserved when no global middleware is registered', async () => {
      @Controller('/')
      class Ctrl {
        @Get('/fast')
        handler(_ctx: RequestContext) {
          return { fast: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/fast')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ fast: true })
      expect((app as any).compiledGlobalPipeline).toBeUndefined()
    })

    it('global guards are NOT invoked on 404 (spy never called, returns 404 not 403)', async () => {
      let canActivateCalls = 0

      class GlobalAuth implements CanActivate {
        canActivate(_ctx: RequestContext): boolean {
          canActivateCalls++
          return false
        }
      }

      @Module({ controllers: [] })
      class M {}

      const app = new Miia({ logger: false }).register(M).useGuard(GlobalAuth)
      const res = await request(app, 'GET', '/unknown')
      expect(res.status).toBe(404)
      expect(canActivateCalls).toBe(0)
    })

    it('global guards still run on matched routes', async () => {
      let canActivateCalls = 0

      class GlobalAuth implements CanActivate {
        canActivate(_ctx: RequestContext): boolean {
          canActivateCalls++
          return true
        }
      }

      @Controller('/')
      class Ctrl {
        @Get('/ok')
        handler(_ctx: RequestContext) {
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M).useGuard(GlobalAuth)
      const res = await request(app, 'GET', '/ok')
      expect(res.status).toBe(200)
      expect(canActivateCalls).toBe(1)
    })

    it('errors from handler bubble through both route and global pipelines', async () => {
      let globalSaw: unknown
      let routeSaw: unknown

      const globalMw: Middleware = async (_ctx, next) => {
        try {
          await next()
        } catch (err) {
          globalSaw = err
          throw err
        }
      }
      const routeMw: Middleware = async (_ctx, next) => {
        try {
          await next()
        } catch (err) {
          routeSaw = err
          throw err
        }
      }

      @Controller('/')
      @Use(routeMw)
      class Ctrl {
        @Get('/boom')
        handler(_ctx: RequestContext) {
          throw new NotFoundException('handler-boom')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(globalMw)
      const res = await request(app, 'GET', '/boom')
      expect(res.status).toBe(404)
      expect(routeSaw).toBeInstanceOf(NotFoundException)
      expect(globalSaw).toBeInstanceOf(NotFoundException)
    })

    it('header set in global middleware survives handler 500', async () => {
      const addRequestId: Middleware = async (ctx, next) => {
        ctx.res.header('X-Request-Id', 'glob-1')
        await next()
      }

      @Controller('/')
      class Ctrl {
        @Get('/kaboom')
        handler(_ctx: RequestContext) {
          throw new Error('kaboom')
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(addRequestId)
      const res = await request(app, 'GET', '/kaboom')
      expect(res.status).toBe(500)
      expect(res.headers.get('x-request-id')).toBe('glob-1')
    })

    it('@SkipGuard filters global guards too (gap fix)', async () => {
      let canActivateCalls = 0

      class GlobalAuth implements CanActivate {
        canActivate(_ctx: RequestContext): boolean {
          canActivateCalls++
          return false
        }
      }

      @Controller('/public')
      class PublicCtrl {
        @Get('/open')
        @SkipGuard(GlobalAuth)
        handler(_ctx: RequestContext) {
          return { open: true }
        }
      }

      @Controller('/private')
      class PrivateCtrl {
        @Get('/data')
        handler(_ctx: RequestContext) {
          return { secret: 42 }
        }
      }

      @Module({ controllers: [PublicCtrl, PrivateCtrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M).useGuard(GlobalAuth)

      const open = await request(app, 'GET', '/public/open')
      expect(open.status).toBe(200)
      expect(await open.json()).toEqual({ open: true })
      expect(canActivateCalls).toBe(0)

      const locked = await request(app, 'GET', '/private/data')
      expect(locked.status).toBe(403)
      expect(canActivateCalls).toBe(1)
    })

    it('Koa-style early termination: middleware does not call next()', async () => {
      let matchCalls = 0
      const authLike: Middleware = async (ctx, _next) => {
        ctx.res.status(401).json({ error: 'unauth' })
      }

      @Controller('/')
      class Ctrl {
        @Get('/protected')
        handler(_ctx: RequestContext) {
          matchCalls++
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(authLike)
      const res = await request(app, 'GET', '/protected')
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauth' })
      expect(matchCalls).toBe(0)
    })

    it('CORS header merges with JSON response (_modified fast-path invariant)', async () => {
      @Controller('/')
      class Ctrl {
        @Get('/data')
        handler(_ctx: RequestContext) {
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(cors({ origin: '*' }))
      const res = await request(app, 'GET', '/data', { headers: { Origin: 'https://example.com' } })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      expect(await res.json()).toEqual({ ok: true })
    })

    it('ctx.params is {} in global middleware before next(), populated after for matched routes', async () => {
      let paramsBeforeNext: Record<string, string> | undefined
      let paramsAfterNext: Record<string, string> | undefined

      const paramsInspector: Middleware = async (ctx, next) => {
        paramsBeforeNext = { ...ctx.params }
        await next()
        paramsAfterNext = { ...ctx.params }
      }

      @Controller('/users')
      class Ctrl {
        @Get('/:id')
        handler(ctx: RequestContext) {
          return { id: ctx.params.id }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M).use(paramsInspector)
      const res = await request(app, 'GET', '/users/42')
      expect(res.status).toBe(200)
      expect(paramsBeforeNext).toEqual({})
      expect(paramsAfterNext).toEqual({ id: '42' })
    })
  })

  describe('HEAD requests', () => {
    it('should return headers without body for HEAD via GET fallback', async () => {
      @Controller('/items')
      class Ctrl {
        @Get('/')
        list(_ctx: RequestContext) {
          return [{ id: 1 }, { id: 2 }]
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'HEAD', '/items/')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/json')
      expect(await res.text()).toBe('')
    })
  })

  describe('native Response return', () => {
    it('should pass through handler-returned Response', async () => {
      @Controller('/')
      class Ctrl {
        @Get('/custom')
        handler(_ctx: RequestContext) {
          return new Response('raw body', {
            status: 201,
            headers: { 'X-Custom': 'yes' },
          })
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/custom')
      expect(res.status).toBe(201)
      expect(res.headers.get('X-Custom')).toBe('yes')
      expect(await res.text()).toBe('raw body')
    })
  })

  describe('rawQuery', () => {
    it('should expose rawQuery with duplicate params', async () => {
      @Controller('/')
      class Ctrl {
        @Get('/filter')
        handler(ctx: RequestContext) {
          return {
            single: ctx.query.tag,
            all: ctx.rawQuery.getAll('tag'),
          }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/filter?tag=a&tag=b&tag=c')
      const json = await res.json()
      expect(json.single).toBe('c')
      expect(json.all).toEqual(['a', 'b', 'c'])
    })
  })

  describe('class-based guards', () => {
    it('should resolve guard from container and call canActivate', async () => {
      class AllowGuard implements CanActivate {
        canActivate(_ctx: RequestContext) {
          return true
        }
      }

      @Controller('/')
      @UseGuard(AllowGuard)
      class Ctrl {
        @Get('/ok')
        handler(_ctx: RequestContext) {
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl], providers: [AllowGuard] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/ok')
      expect(res.status).toBe(200)
    })

    it('should return 403 when guard returns false', async () => {
      class DenyGuard implements CanActivate {
        canActivate(_ctx: RequestContext) {
          return false
        }
      }

      @Controller('/')
      @UseGuard(DenyGuard)
      class Ctrl {
        @Get('/denied')
        handler(_ctx: RequestContext) {
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/denied')
      expect(res.status).toBe(403)
    })

    it('should propagate exception thrown by guard', async () => {
      class AuthGuard implements CanActivate {
        canActivate(_ctx: RequestContext): boolean {
          throw new UnauthorizedException('No token')
        }
      }

      @Controller('/')
      @UseGuard(AuthGuard)
      class Ctrl {
        @Get('/secret')
        handler(_ctx: RequestContext) {
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/secret')
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ message: 'No token' })
    })

    it('should support guard with DI dependencies', async () => {
      @Injectable()
      class TokenService {
        verify(token: string) {
          return token === 'valid' ? { id: 1, name: 'Alice' } : null
        }
      }

      @Injectable()
      class JwtGuard implements CanActivate {
        private tokenService = inject(TokenService)

        canActivate(ctx: RequestContext) {
          const header = ctx.req.headers.get('authorization')
          if (!header?.startsWith('Bearer ')) throw new UnauthorizedException()
          const user = this.tokenService.verify(header.slice(7))
          if (!user) throw new UnauthorizedException()
          ;(ctx as any).user = user
          return true
        }
      }

      @Controller('/')
      @UseGuard(JwtGuard)
      class Ctrl {
        @Get('/me')
        handler(ctx: RequestContext) {
          return (ctx as any).user
        }
      }

      @Module({ controllers: [Ctrl], providers: [TokenService, JwtGuard] })
      class M {}

      const app = new Miia({ logger: false }).register(M)

      const ok = await request(app, 'GET', '/me', { headers: { Authorization: 'Bearer valid' } })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toEqual({ id: 1, name: 'Alice' })

      const fail = await request(app, 'GET', '/me', { headers: { Authorization: 'Bearer bad' } })
      expect(fail.status).toBe(401)
    })

    it('should support method-level guards', async () => {
      class AdminGuard implements CanActivate {
        canActivate(ctx: RequestContext) {
          return ctx.req.headers.get('x-role') === 'admin'
        }
      }

      @Controller('/')
      class Ctrl {
        @Get('/public')
        pub(_ctx: RequestContext) {
          return { public: true }
        }

        @Get('/admin')
        @UseGuard(AdminGuard)
        admin(_ctx: RequestContext) {
          return { admin: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)

      const pub = await request(app, 'GET', '/public')
      expect(pub.status).toBe(200)

      const denied = await request(app, 'GET', '/admin')
      expect(denied.status).toBe(403)

      const allowed = await request(app, 'GET', '/admin', { headers: { 'x-role': 'admin' } })
      expect(allowed.status).toBe(200)
    })

    it('should support parameterized guard via wrapper function', async () => {
      function Roles(...roles: string[]) {
        class RolesGuard implements CanActivate {
          canActivate(ctx: RequestContext) {
            return roles.includes(ctx.req.headers.get('x-role') ?? '')
          }
        }

        return RolesGuard
      }

      @Controller('/')
      class Ctrl {
        @Get('/editor')
        @UseGuard(Roles('editor', 'admin'))
        handler(_ctx: RequestContext) {
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)

      const denied = await request(app, 'GET', '/editor', { headers: { 'x-role': 'viewer' } })
      expect(denied.status).toBe(403)

      const allowed = await request(app, 'GET', '/editor', { headers: { 'x-role': 'editor' } })
      expect(allowed.status).toBe(200)
    })

    it('@SkipGuard(Guard) should skip only that guard', async () => {
      class GuardA implements CanActivate {
        canActivate() {
          return false // always deny
        }
      }
      class GuardB implements CanActivate {
        canActivate() {
          return true
        }
      }

      @Controller('/')
      @UseGuard(GuardA, GuardB)
      class Ctrl {
        @Get('/skipped')
        @SkipGuard(GuardA)
        skipped() {
          return { ok: true }
        }

        @Get('/both')
        both() {
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)

      // GuardA skipped, GuardB passes → 200
      const skipped = await request(app, 'GET', '/skipped')
      expect(skipped.status).toBe(200)

      // Both guards active, GuardA denies → 403
      const both = await request(app, 'GET', '/both')
      expect(both.status).toBe(403)
    })

    it('@SkipGuard(factory) should match via GUARD_FACTORY', async () => {
      function createGuard(shouldDeny: boolean) {
        class DynGuard implements CanActivate {
          canActivate() {
            return !shouldDeny
          }
        }
        ;(DynGuard as any)[GUARD_FACTORY] = createGuard
        return DynGuard
      }

      @Controller('/')
      @UseGuard(createGuard(true))
      class Ctrl {
        @Get('/skipped')
        @SkipGuard(createGuard)
        skipped() {
          return { ok: true }
        }

        @Get('/guarded')
        guarded() {
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)

      // Factory guard skipped → 200
      const skipped = await request(app, 'GET', '/skipped')
      expect(skipped.status).toBe(200)

      // Factory guard active, denies → 403
      const guarded = await request(app, 'GET', '/guarded')
      expect(guarded.status).toBe(403)
    })
  })

  describe('duplicate providers', () => {
    it('should throw on duplicate class provider', () => {
      @Injectable()
      class SharedService {}

      @Module({ providers: [SharedService] })
      class ModuleA {}

      @Module({ providers: [SharedService] })
      class ModuleB {}

      expect(() => new Miia({ logger: false }).register(ModuleA, ModuleB)).toThrow(
        '[Miia] Duplicate provider: SharedService is already registered',
      )
    })
  })

  describe('@ValidateBody', () => {
    it('should auto-parse and validate JSON body', async () => {
      const schema: ZodLike = {
        safeParse(data: unknown) {
          const d = data as any
          if (d && typeof d.name === 'string') {
            return { success: true as const, data: d }
          }
          return { success: false as const, error: { issues: [{ message: 'name required' }] } }
        },
      }

      @Controller('/')
      class Ctrl {
        @Post('/echo')
        @ValidateBody(schema)
        async echo(ctx: RequestContext) {
          return { received: await ctx.json() }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)

      // Valid body
      const res = await request(app, 'POST', '/echo', { body: { name: 'test' } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ received: { name: 'test' } })

      // Invalid body
      const res2 = await request(app, 'POST', '/echo', { body: { bad: true } })
      expect(res2.status).toBe(422)
    })

    it('should expose validated data through ctx.json() after validator runs', async () => {
      const schema: ZodLike = {
        safeParse(data: unknown) {
          const d = data as any
          if (d && typeof d.value === 'number') {
            return { success: true as const, data: { value: d.value * 2, transformed: true } }
          }
          return { success: false as const, error: { issues: [] } }
        },
      }

      @Controller('/')
      class Ctrl {
        @Post('/transform')
        @ValidateBody(schema)
        async handler(ctx: RequestContext) {
          return await ctx.json()
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'POST', '/transform', { body: { value: 21 } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ value: 42, transformed: true })
    })
  })

  describe('ctx body helpers', () => {
    it('ctx.json() returns parsed body without a validator', async () => {
      @Controller('/')
      class Ctrl {
        @Post('/raw')
        async handler(ctx: RequestContext) {
          const data = await ctx.json<{ hello: string }>()
          return { echoed: data.hello }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'POST', '/raw', { body: { hello: 'world' } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ echoed: 'world' })
    })

    it('ctx.json() caches: second call returns the same object (identity)', async () => {
      let firstRef: unknown = null
      let secondRef: unknown = null

      @Controller('/')
      class Ctrl {
        @Post('/cache')
        async handler(ctx: RequestContext) {
          firstRef = await ctx.json()
          secondRef = await ctx.json()
          return { identity: firstRef === secondRef }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'POST', '/cache', { body: { a: 1 } })
      expect(await res.json()).toEqual({ identity: true })
    })

    it('ctx.json() is shared between middleware and @ValidateBody (no double parse)', async () => {
      let middlewareBody: unknown = null
      let handlerBody: unknown = null

      const schema: ZodLike = {
        safeParse(data: unknown) {
          return { success: true as const, data }
        },
      }

      const readBodyMw: Middleware = async (ctx, next) => {
        middlewareBody = await ctx.json()
        await next()
      }

      @Controller('/')
      class Ctrl {
        @Post('/shared')
        @ValidateBody(schema)
        async handler(ctx: RequestContext) {
          handlerBody = await ctx.json()
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).use(readBodyMw).register(M)
      const res = await request(app, 'POST', '/shared', { body: { shared: true } })
      expect(res.status).toBe(200)
      // middleware saw the raw body; handler saw validated (here identical) data
      expect(middlewareBody).toEqual({ shared: true })
      expect(handlerBody).toEqual({ shared: true })
    })

    it('ctx._setBody() overrides cached body', async () => {
      const overrideMw: Middleware = async (ctx, next) => {
        await ctx.json() // prime cache with raw body
        ctx._setBody({ overridden: true })
        await next()
      }

      @Controller('/')
      class Ctrl {
        @Post('/override')
        async handler(ctx: RequestContext) {
          return await ctx.json()
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).use(overrideMw).register(M)
      const res = await request(app, 'POST', '/override', { body: { raw: 1 } })
      expect(await res.json()).toEqual({ overridden: true })
    })

    it('ctx.text() returns the raw request body as text', async () => {
      @Controller('/')
      class Ctrl {
        @Post('/echo-text')
        async handler(ctx: RequestContext) {
          return { text: await ctx.text() }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const req = new Request('http://localhost/echo-text', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'hello plain text',
      })
      const res = await app.fetch(req)
      expect(await res.json()).toEqual({ text: 'hello plain text' })
    })

    it('ctx.json() caches rejection for malformed JSON', async () => {
      let firstError: unknown = null
      let secondError: unknown = null

      @Controller('/')
      class Ctrl {
        @Post('/bad')
        async handler(ctx: RequestContext) {
          try {
            await ctx.json()
          } catch (e) {
            firstError = e
          }
          try {
            await ctx.json()
          } catch (e) {
            secondError = e
          }
          return { same: firstError === secondError }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const req = new Request('http://localhost/bad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ not json',
      })
      const res = await app.fetch(req)
      expect(await res.json()).toEqual({ same: true })
    })

    it('ctx.json() on GET rejects and caches the rejection', async () => {
      let rejected = false

      @Controller('/')
      class Ctrl {
        @Get('/no-body')
        async handler(ctx: RequestContext) {
          try {
            await ctx.json()
          } catch {
            rejected = true
          }
          return { rejected }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      const res = await request(app, 'GET', '/no-body')
      expect(await res.json()).toEqual({ rejected: true })
    })
  })

  describe('listen()', () => {
    it('should call adapter with { port, hostname, fetch }', async () => {
      @Controller('/')
      class Ctrl {
        @Get('/') handler(_ctx: RequestContext) {
          return { ok: true }
        }
      }

      @Module({ controllers: [Ctrl] })
      class M {}

      const app = new Miia({ logger: false }).register(M)
      let receivedInfo: any = null

      await app.listen(4000, (info) => {
        receivedInfo = info
      })

      expect(receivedInfo).not.toBeNull()
      expect(receivedInfo.port).toBe(4000)
      expect(receivedInfo.hostname).toBe('0.0.0.0')
      expect(typeof receivedInfo.fetch).toBe('function')

      await app.destroy()
    })

    it('should pass custom hostname to adapter', async () => {
      const app = new Miia({ logger: false })
      let receivedHostname = ''

      await app.listen(4001, 'localhost', (info) => {
        receivedHostname = info.hostname
      })

      expect(receivedHostname).toBe('localhost')
      await app.destroy()
    })

    it('should call close on destroy when adapter returns ServerHandle', async () => {
      const app = new Miia({ logger: false })
      let closed = false

      await app.listen(4002, () => ({
        close() {
          closed = true
        },
      }))

      expect(closed).toBe(false)
      await app.destroy()
      expect(closed).toBe(true)
    })

    it('should throw when no runtime and no adapter', async () => {
      // Skip in Bun/Deno - they have built-in servers, so listen() succeeds
      if ('Bun' in globalThis || 'Deno' in globalThis) return

      const app = new Miia({ logger: false })

      await expect(app.listen(4003)).rejects.toThrow('No runtime detected')
    })
  })

  describe('shutdown hooks', () => {
    const SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const
    type SignalName = (typeof SIGNALS)[number]
    type ListenerFn = (signal: SignalName) => void

    let exitCode: number | null = null
    let exitCalled = false
    const origExit = process.exit
    let listenerSnapshot: Record<SignalName, ListenerFn[]> | null = null

    const flush = async () => {
      // Allow async signal handler (with multiple awaits in destroy()) to settle.
      // Polling rather than a single setImmediate because the handler awaits
      // closeServer + container.destroyAll, which need a few microtasks each.
      const timeout = Date.now() + 1000
      while (!exitCalled && Date.now() < timeout) {
        await new Promise((r) => setImmediate(r))
      }
    }

    const noopAdapter = (info: { port: number; hostname: string; fetch: (req: Request) => Promise<Response> }) => {
      void info
      return { close() {} }
    }

    beforeEach(() => {
      exitCode = null
      exitCalled = false
      // No throw - handler is `void handler(signal)` from process.once, so a
      // throw would surface as an unhandled rejection in the test runner.
      // Recording a no-op exit lets the handler complete naturally.
      // @ts-expect-error - overriding process.exit signature
      process.exit = (code?: number) => {
        exitCalled = true
        exitCode = code ?? 0
        return undefined as never
      }
      listenerSnapshot = {
        SIGTERM: [...(process.listeners('SIGTERM') as ListenerFn[])],
        SIGINT: [...(process.listeners('SIGINT') as ListenerFn[])],
        SIGHUP: [...(process.listeners('SIGHUP') as ListenerFn[])],
      }
    })

    afterEach(() => {
      process.exit = origExit
      // Remove only listeners added during this test - preserves Bun test
      // runner internal SIGINT for test isolation.
      if (listenerSnapshot) {
        for (const sig of SIGNALS) {
          const before = new Set(listenerSnapshot[sig])
          for (const l of process.listeners(sig) as ListenerFn[]) {
            if (!before.has(l)) {
              process.off(sig, l as NodeJS.SignalsListener)
            }
          }
        }
        listenerSnapshot = null
      }
    })

    it('registers SIGTERM/SIGINT/SIGHUP handlers when shutdownHooks default to true', async () => {
      const app = new Miia({ logger: false })
      const before = {
        SIGTERM: process.listeners('SIGTERM').length,
        SIGINT: process.listeners('SIGINT').length,
        SIGHUP: process.listeners('SIGHUP').length,
      }
      await app.listen(5000, noopAdapter)

      expect(process.listeners('SIGTERM').length).toBe(before.SIGTERM + 1)
      expect(process.listeners('SIGINT').length).toBe(before.SIGINT + 1)
      // SIGHUP is filtered on Windows; handle either case.
      const expectedSighup = process.platform === 'win32' ? before.SIGHUP : before.SIGHUP + 1
      expect(process.listeners('SIGHUP').length).toBe(expectedSighup)

      await app.destroy()
    })

    it('does not register signal handlers when shutdownHooks: false', async () => {
      const app = new Miia({ logger: false, shutdownHooks: false })
      const before = {
        SIGTERM: process.listeners('SIGTERM').length,
        SIGINT: process.listeners('SIGINT').length,
        SIGHUP: process.listeners('SIGHUP').length,
      }
      await app.listen(5001, noopAdapter)

      expect(process.listeners('SIGTERM').length).toBe(before.SIGTERM)
      expect(process.listeners('SIGINT').length).toBe(before.SIGINT)
      expect(process.listeners('SIGHUP').length).toBe(before.SIGHUP)

      await app.destroy()
    })

    it('registers only specified signals when shutdownHooks: ["SIGTERM"]', async () => {
      const app = new Miia({ logger: false, shutdownHooks: ['SIGTERM'] })
      const before = {
        SIGTERM: process.listeners('SIGTERM').length,
        SIGINT: process.listeners('SIGINT').length,
        SIGHUP: process.listeners('SIGHUP').length,
      }
      await app.listen(5002, noopAdapter)

      expect(process.listeners('SIGTERM').length).toBe(before.SIGTERM + 1)
      expect(process.listeners('SIGINT').length).toBe(before.SIGINT)
      expect(process.listeners('SIGHUP').length).toBe(before.SIGHUP)

      await app.destroy()
    })

    it('idempotent: calling listen twice does not double-register handlers', async () => {
      const app = new Miia({ logger: false })
      const initial = process.listeners('SIGTERM').length

      await app.listen(5003, noopAdapter)
      const afterFirst = process.listeners('SIGTERM').length
      expect(afterFirst).toBe(initial + 1)

      await app.listen(5004, noopAdapter)
      const afterSecond = process.listeners('SIGTERM').length
      expect(afterSecond).toBe(afterFirst)

      await app.destroy()
    })

    it('shutdown handler calls destroy() on signal and exits with code 0', async () => {
      let closed = false
      const app = new Miia({ logger: false })
      await app.listen(5005, () => ({
        close() {
          closed = true
        },
      }))

      process.emit('SIGTERM')
      await flush()

      expect(closed).toBe(true)
      expect(exitCalled).toBe(true)
      expect(exitCode).toBe(0)
    })

    it('shutdown handler exits with code 1 if destroy throws', async () => {
      const app = new Miia({ logger: false })
      await app.listen(5006, () => ({
        close() {
          throw new Error('close exploded')
        },
      }))

      process.emit('SIGTERM')
      await flush()

      expect(exitCalled).toBe(true)
      expect(exitCode).toBe(1)
    })

    it('concurrent signals: only the first triggers shutdown', async () => {
      // Skip on Windows - SIGHUP is filtered there, second signal would have no handler.
      if (process.platform === 'win32') return

      let closeCount = 0
      const app = new Miia({ logger: false })
      await app.listen(5007, () => ({
        async close() {
          closeCount++
          // Slow close so the second emit happens while first is still running.
          await new Promise((r) => setTimeout(r, 30))
        },
      }))

      process.emit('SIGTERM')
      // SIGHUP rather than SIGINT to avoid Bun test runner SIGINT handler interaction.
      process.emit('SIGHUP')
      await flush()
      // Give the slow close time to complete.
      await new Promise((r) => setTimeout(r, 60))

      expect(closeCount).toBe(1)
      expect(exitCalled).toBe(true)
      expect(exitCode).toBe(0)
    })

    it('destroy() unregisters signal handlers', async () => {
      const app = new Miia({ logger: false })
      const before = {
        SIGTERM: process.listeners('SIGTERM').length,
        SIGINT: process.listeners('SIGINT').length,
        SIGHUP: process.listeners('SIGHUP').length,
      }
      await app.listen(5008, noopAdapter)

      expect(process.listeners('SIGTERM').length).toBeGreaterThan(before.SIGTERM)
      expect(process.listeners('SIGINT').length).toBeGreaterThan(before.SIGINT)

      await app.destroy()

      expect(process.listeners('SIGTERM').length).toBe(before.SIGTERM)
      expect(process.listeners('SIGINT').length).toBe(before.SIGINT)
      expect(process.listeners('SIGHUP').length).toBe(before.SIGHUP)
    })

    it('listen → destroy → listen re-registers handlers', async () => {
      const app = new Miia({ logger: false })
      const initial = process.listeners('SIGTERM').length

      await app.listen(5009, noopAdapter)
      expect(process.listeners('SIGTERM').length).toBe(initial + 1)

      await app.destroy()
      expect(process.listeners('SIGTERM').length).toBe(initial)

      await app.listen(5010, noopAdapter)
      expect(process.listeners('SIGTERM').length).toBe(initial + 1)

      await app.destroy()
      expect(process.listeners('SIGTERM').length).toBe(initial)
    })
  })
})
