import { describe, expect, it } from 'bun:test'
import type { CanActivate, Constructor, Middleware, RequestContext, RouteOptions, ZodLike } from '../src/index.js'
import {
  BodyLimit,
  Container,
  Controller,
  Delete,
  Get,
  Head,
  Logger,
  Miia,
  Module,
  Options,
  Post,
  Put,
  Router,
  UnauthorizedException,
  Use,
  UseGuard,
} from '../src/index.js'
import { RouterExplorer } from '../src/app/router-explorer.js'

interface SpySchema<T> extends ZodLike<T> {
  calls: number
}

function schema<T>(parse: (data: any) => T | undefined, message: string): SpySchema<T> {
  const s: SpySchema<T> = {
    calls: 0,
    safeParse(data) {
      s.calls++
      const value = parse(data)
      return value === undefined
        ? { success: false, error: { issues: [{ path: [], message }] } }
        : { success: true, data: value }
    },
  }
  return s
}

const idParams = () => schema((p) => (/^\d+$/.test(p.id) ? { id: Number(p.id) } : undefined), 'id must be numeric')
const pageQuery = () => schema((q) => (/^\d+$/.test(q.page) ? { page: Number(q.page) } : undefined), 'page required')
const nameBody = () =>
  schema((b) => (typeof b?.name === 'string' ? { name: b.name.toUpperCase() } : undefined), 'name required')

function createApp(...controllers: Constructor[]) {
  @Module({ controllers })
  class M {}
  return new Miia({ logger: false }).register(M)
}

async function request(
  app: Miia,
  method: string,
  path: string,
  options: { body?: unknown; raw?: string; headers?: Record<string, string> } = {},
) {
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  const headers: Record<string, string> = { ...options.headers }
  if (body !== undefined) {
    headers['content-type'] ??= 'application/json'
    // Bun does not add content-length to constructed Requests; the body limit check reads it.
    headers['content-length'] ??= String(new TextEncoder().encode(body).byteLength)
  }
  return app.fetch(new Request(`http://localhost${path}`, { method, body, headers }))
}

describe('route schemas', () => {
  describe('validation', () => {
    it('validates params, query and body and hands the transformed data to the handler', async () => {
      @Controller('/items')
      class Ctrl {
        @Put('/:id', { params: idParams(), query: pageQuery(), body: nameBody() })
        async update(ctx: RequestContext) {
          return { params: ctx.params, query: ctx.query, body: await ctx.json() }
        }
      }

      const app = createApp(Ctrl)
      const res = await request(app, 'PUT', '/items/42?page=2', { body: { name: 'ab' } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ params: { id: 42 }, query: { page: 2 }, body: { name: 'AB' } })
    })

    it('answers 422 with the issues and the message of the failing part', async () => {
      @Controller('/items')
      class Ctrl {
        @Put('/:id', { params: idParams(), query: pageQuery(), body: nameBody() })
        update() {
          return { ok: true }
        }
      }

      const app = createApp(Ctrl)

      const params = await request(app, 'PUT', '/items/abc?page=2', { body: { name: 'ab' } })
      expect(params.status).toBe(422)
      expect(await params.json()).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Params validation failed',
        details: [{ path: [], message: 'id must be numeric' }],
      })

      const query = await request(app, 'PUT', '/items/1?page=x', { body: { name: 'ab' } })
      expect(query.status).toBe(422)
      expect(await query.json()).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Query validation failed',
        details: [{ path: [], message: 'page required' }],
      })

      const body = await request(app, 'PUT', '/items/1?page=2', { body: { title: 'ab' } })
      expect(body.status).toBe(422)
      expect(await body.json()).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Body validation failed',
        details: [{ path: [], message: 'name required' }],
      })
    })

    it('checks params, then query, then body', async () => {
      const body = nameBody()

      @Controller('/items')
      class Ctrl {
        @Put('/:id', { body, query: pageQuery(), params: idParams() })
        update() {
          return { ok: true }
        }
      }

      const app = createApp(Ctrl)

      const params = await request(app, 'PUT', '/items/abc?page=2', { body: {} })
      expect((await params.json()).message).toBe('Params validation failed')

      const query = await request(app, 'PUT', '/items/1?page=x', { body: {} })
      expect((await query.json()).message).toBe('Query validation failed')

      expect(body.calls).toBe(0)
    })

    it('answers 400 on malformed JSON without running the schema', async () => {
      const body = nameBody()

      @Controller('/items')
      class Ctrl {
        @Post('/', { body })
        create() {
          return { ok: true }
        }
      }

      const app = createApp(Ctrl)
      const res = await request(app, 'POST', '/items', { raw: '{"name":' })
      expect(res.status).toBe(400)
      expect((await res.json()).message).toBe('Malformed JSON body')
      expect(body.calls).toBe(0)
    })

    it('hands an empty or missing body to the schema as undefined and answers 422', async () => {
      const seen: unknown[] = []
      const body = schema((b) => {
        seen.push(b)
        return undefined
      }, 'name required')

      @Controller('/items')
      class Ctrl {
        @Post('/', { body })
        create() {
          return { ok: true }
        }
      }

      const app = createApp(Ctrl)

      const empty = await request(app, 'POST', '/items', { raw: '' })
      expect(empty.status).toBe(422)
      expect((await empty.json()).message).toBe('Body validation failed')

      const missing = await request(app, 'POST', '/items')
      expect(missing.status).toBe(422)
      expect((await missing.json()).message).toBe('Body validation failed')

      expect(seen).toEqual([undefined, undefined])
    })

    it('answers 413 on a Content-Length over @BodyLimit before the schema runs', async () => {
      const body = nameBody()

      @Controller('/items')
      class Ctrl {
        @Post('/', { body })
        @BodyLimit(10)
        create() {
          return { ok: true }
        }
      }

      const app = createApp(Ctrl)
      const res = await request(app, 'POST', '/items', { body: { name: 'a name well over ten bytes' } })
      expect(res.status).toBe(413)
      expect(body.calls).toBe(0)
    })
  })

  describe('position in the pipeline', () => {
    it('lets a guard that returns false answer 403 before the body is validated', async () => {
      class DenyGuard implements CanActivate {
        canActivate() {
          return false
        }
      }
      const body = nameBody()

      @Controller('/items')
      class Ctrl {
        @Post('/', { body })
        @UseGuard(DenyGuard)
        create() {
          return { ok: true }
        }
      }

      const app = createApp(Ctrl)
      const res = await request(app, 'POST', '/items', { body: { bad: true } })
      expect(res.status).toBe(403)
      expect(body.calls).toBe(0)
    })

    it('lets a guard that throws UnauthorizedException answer 401 before the body is validated', async () => {
      class AuthGuard implements CanActivate {
        canActivate(): boolean {
          throw new UnauthorizedException()
        }
      }
      const body = nameBody()

      @Controller('/items')
      class Ctrl {
        @Post('/', { body })
        @UseGuard(AuthGuard)
        create() {
          return { ok: true }
        }
      }

      const app = createApp(Ctrl)
      const res = await request(app, 'POST', '/items', { body: { bad: true } })
      expect(res.status).toBe(401)
      expect(body.calls).toBe(0)
    })

    it('runs inside method @Use: raw params before next(), validated params after', async () => {
      const seen: unknown[] = []
      const spy: Middleware = async (ctx, next) => {
        seen.push({ ...ctx.params })
        await next()
        seen.push({ ...ctx.params })
      }

      @Controller('/items')
      class Ctrl {
        @Get('/:id', { params: idParams() })
        @Use(spy)
        show(ctx: RequestContext) {
          return ctx.params
        }
      }

      const app = createApp(Ctrl)
      const res = await request(app, 'GET', '/items/7')
      expect(await res.json()).toEqual({ id: 7 })
      expect(seen).toEqual([{ id: '7' }, { id: 7 }])
    })

    it('adds no middleware to a route without schemas', () => {
      Logger.setLogger({ log() {}, error() {}, warn() {} })

      @Controller('/')
      class Ctrl {
        @Get('/plain')
        plain() {}

        @Get('/checked', { query: pageQuery() })
        checked() {}
      }

      const router = new Router()
      new RouterExplorer(router, new Container()).explore(new Ctrl(), Ctrl, '')
      router.compileAll([])

      expect(router.match('GET', '/plain')).not.toBeNull()
      expect(router.match('GET', '/plain')?.compiledPipeline).toBeUndefined()
      expect(router.match('GET', '/checked')?.compiledPipeline).toBeDefined()
    })
  })

  describe('options-only overload', () => {
    it('registers the controller root route from @Post(options) and @Get(options)', async () => {
      @Controller('/things')
      class Ctrl {
        @Post({ body: nameBody() })
        async create(ctx: RequestContext) {
          return ctx.json()
        }

        @Get({ query: pageQuery() })
        list(ctx: RequestContext) {
          return ctx.query
        }
      }

      const app = createApp(Ctrl)

      const created = await request(app, 'POST', '/things', { body: { name: 'ab' } })
      expect(await created.json()).toEqual({ name: 'AB' })

      const listed = await request(app, 'GET', '/things?page=3')
      expect(await listed.json()).toEqual({ page: 3 })

      const invalid = await request(app, 'GET', '/things')
      expect(invalid.status).toBe(422)
    })

    it('accepts params and body together on @Delete', async () => {
      @Controller('/things')
      class Ctrl {
        @Delete('/:id', { params: idParams(), body: nameBody() })
        async remove(ctx: RequestContext) {
          return { id: ctx.params.id, body: await ctx.json() }
        }
      }

      const app = createApp(Ctrl)
      const res = await request(app, 'DELETE', '/things/5', { body: { name: 'x' } })
      expect(await res.json()).toEqual({ id: 5, body: { name: 'X' } })
    })
  })

  describe('decoration-time checks', () => {
    it('throws when untyped code passes a body schema to GET, HEAD or OPTIONS', () => {
      const opts = { body: nameBody() } as any

      expect(() => {
        class C {
          @Get('/', opts)
          m() {}
        }
      }).toThrow("@Get takes no body schema: GET has no request body (handler 'm')")
      expect(() => {
        class C {
          @Head(opts)
          m() {}
        }
      }).toThrow("@Head takes no body schema: HEAD has no request body (handler 'm')")
      expect(() => {
        class C {
          @Options('/', opts)
          m() {}
        }
      }).toThrow("@Options takes no body schema: OPTIONS has no request body (handler 'm')")
    })

    it('throws when two routes on one handler declare different schemas for a key', () => {
      expect(() => {
        class C {
          @Get('a', { query: pageQuery() })
          @Get('b', { query: pageQuery() })
          m() {}
        }
      }).toThrow(
        "@Get declares a different query schema than another route on handler 'm': routes on one handler share their schemas",
      )
    })

    it('throws when a GET route and a body schema share a handler, in either order', () => {
      expect(() => {
        class C {
          @Get('/x')
          @Post('/x', { body: nameBody() })
          m() {}
        }
      }).toThrow("@Get cannot share handler 'm' with a route that declares a body schema: GET has no request body")
      expect(() => {
        class C {
          @Post('/x', { body: nameBody() })
          @Get('/x')
          m() {}
        }
      }).toThrow("@Post declares a body schema, but handler 'm' also serves GET, which has no request body")
    })

    it('lets routes on one handler repeat a schema or leave it out, sharing it', async () => {
      const query = pageQuery()

      @Controller('/')
      class Ctrl {
        @Get('a')
        @Get('b', { query })
        @Get('c', { query })
        list(ctx: RequestContext) {
          return ctx.query
        }
      }

      const app = createApp(Ctrl)
      for (const path of ['/a', '/b', '/c']) {
        expect((await request(app, 'GET', `${path}?page=1`)).status).toBe(200)
        expect((await request(app, 'GET', path)).status).toBe(422)
      }
    })
  })

  describe('types', () => {
    const body = nameBody()

    it('rejects a body schema in @Get(path, options)', () => {
      expect(() => {
        class C {
          // @ts-expect-error - GET takes no body
          @Get('/', { body })
          m() {}
        }
      }).toThrow(TypeError)
    })

    it('rejects a body schema in @Get(options)', () => {
      expect(() => {
        class C {
          // @ts-expect-error - GET takes no body
          @Get({ body })
          m() {}
        }
      }).toThrow(TypeError)
    })

    it('rejects a body schema on @Head', () => {
      expect(() => {
        class C {
          // @ts-expect-error - HEAD takes no body
          @Head('/', { body })
          m() {}
        }
      }).toThrow(TypeError)
    })

    it('rejects a body schema on @Options', () => {
      expect(() => {
        class C {
          // @ts-expect-error - OPTIONS takes no body
          @Options({ body })
          m() {}
        }
      }).toThrow(TypeError)
    })

    it('rejects RouteOptions from a variable on @Get', () => {
      const opts: RouteOptions = { body }
      expect(() => {
        class C {
          // @ts-expect-error - RouteOptions may carry a body
          @Get('/', opts)
          m() {}
        }
      }).toThrow(TypeError)
    })
  })
})
