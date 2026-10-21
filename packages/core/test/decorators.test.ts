import { describe, expect, it } from 'bun:test'
import { Controller, Get, Injectable, Module, Post, SkipGuard, UseGuard } from '../src/decorators/index.js'
import { getMeta, INJECTABLE, PREFIX, MODULE, ROUTES, SKIP_GUARDS } from '../src/decorators/index.js'
import { BODY_SCHEMAS, PARAMS_SCHEMAS, QUERY_SCHEMAS } from '../src/decorators/index.js'
import { addToMapMeta, createMethodDecorator, pushMeta, setInMapMeta } from '../src/decorators/index.js'
import type { InjectableMeta } from '../src/decorators/index.js'
import { Miia } from '../src/index.js'
import type { Constructor, ModuleOptions, RequestContext, RouteDefinition, ZodLike } from '../src/types.js'

describe('Decorators', () => {
  describe('@Injectable', () => {
    it('should store injectable metadata with default scope', () => {
      @Injectable()
      class TestService {
        value = 'test'
      }

      const meta = getMeta<InjectableMeta>(TestService, INJECTABLE)
      expect(meta).toBeDefined()
      expect(meta!.scope).toBe('singleton')
      expect(meta!.hint).toBeUndefined()
    })

    it('should store custom scope in metadata', () => {
      @Injectable({ scope: 'transient' })
      class TransientService {}

      const meta = getMeta<InjectableMeta>(TransientService, INJECTABLE)
      expect(meta!.scope).toBe('transient')
    })

    it('should store hint in metadata', () => {
      @Injectable({ hint: 'UsersModule' })
      class HintedService {
        name = 'hinted'
      }

      const meta = getMeta<InjectableMeta>(HintedService, INJECTABLE)
      expect(meta!.hint).toBe('UsersModule')
      expect(meta!.scope).toBe('singleton')
    })

    it('should not register in any container as side effect', () => {
      @Injectable()
      class PureMetadataService {}

      const meta = getMeta<InjectableMeta>(PureMetadataService, INJECTABLE)
      expect(meta).toBeDefined()
    })
  })

  describe('@Controller', () => {
    it('should store prefix metadata', () => {
      @Controller('/api/users')
      class UserController {}

      expect(getMeta<string>(UserController, PREFIX)).toBe('/api/users')
    })

    it('should default to empty prefix', () => {
      @Controller()
      class RootController {}

      expect(getMeta<string>(RootController, PREFIX)).toBe('')
    })

    it('should not register in any container as side effect', () => {
      @Controller('/test')
      class TestController {}

      expect(getMeta<string>(TestController, PREFIX)).toBe('/test')
    })
  })

  describe('@Module', () => {
    it('should store module metadata', () => {
      @Module({
        controllers: [],
        providers: [],
        prefix: '/api',
      })
      class AppModule {}

      const meta = getMeta<ModuleOptions>(AppModule, MODULE)
      expect(meta).toBeDefined()
      expect(meta!.prefix).toBe('/api')
      expect(meta!.controllers).toEqual([])
      expect(meta!.providers).toEqual([])
    })

    it('should store imports', () => {
      @Module({})
      class SubModule {}

      @Module({
        imports: [SubModule],
      })
      class MainModule {}

      const meta = getMeta<ModuleOptions>(MainModule, MODULE)
      expect(meta!.imports).toEqual([SubModule])
    })
  })

  describe('metadata inheritance', () => {
    it('pushMeta on a subclass does not change the parent list', () => {
      const LIST = Symbol('list')
      const Mark = createMethodDecorator<[tag: string]>((_target, context, tag) => {
        pushMeta(context.metadata!, LIST, tag)
      })

      class Parent {
        @Mark('p')
        a() {}
      }

      class Child extends Parent {
        @Mark('c1')
        b() {}

        @Mark('c2')
        c() {}
      }

      expect(getMeta<string[]>(Parent, LIST)).toEqual(['p'])
      expect(getMeta<string[]>(Child, LIST)).toEqual(['p', 'c1', 'c2'])
    })

    it('addToMapMeta on a subclass does not change the parent map', () => {
      const MAP = Symbol('map')
      const Tag = createMethodDecorator<[...tags: string[]]>((_target, context, ...tags) => {
        addToMapMeta(context.metadata!, MAP, String(context.name), tags)
      })

      class Parent {
        @Tag('p')
        a() {}
      }

      class Child extends Parent {
        @Tag('c')
        b() {}

        @Tag('c2')
        override a() {}
      }

      expect([...getMeta<Map<string, string[]>>(Parent, MAP)!]).toEqual([['a', ['p']]])
      expect([...getMeta<Map<string, string[]>>(Child, MAP)!]).toEqual([
        ['a', ['p', 'c2']],
        ['b', ['c']],
      ])
    })

    it('setInMapMeta on a subclass does not change the parent map', () => {
      const MAP = Symbol('map')
      const Value = createMethodDecorator<[value: number]>((_target, context, value) => {
        setInMapMeta(context.metadata!, MAP, String(context.name), value)
      })

      class Parent {
        @Value(1)
        a() {}
      }

      class Child extends Parent {
        @Value(2)
        b() {}

        @Value(3)
        override a() {}
      }

      expect([...getMeta<Map<string, number>>(Parent, MAP)!]).toEqual([['a', 1]])
      expect([...getMeta<Map<string, number>>(Child, MAP)!]).toEqual([
        ['a', 3],
        ['b', 2],
      ])
    })

    it('@SkipGuard on a subclass method does not appear in the parent', () => {
      class GuardA {
        canActivate() {
          return true
        }
      }
      class GuardB {
        canActivate() {
          return true
        }
      }

      class Parent {
        @SkipGuard(GuardA)
        a() {}
      }

      class Child extends Parent {
        @SkipGuard(GuardB)
        override a() {}

        @SkipGuard(GuardA)
        b() {}
      }

      const parent = getMeta<Map<string, Set<unknown>>>(Parent, SKIP_GUARDS)!
      expect([...parent.keys()]).toEqual(['a'])
      expect([...parent.get('a')!]).toEqual([GuardA])

      const child = getMeta<Map<string, Set<unknown>>>(Child, SKIP_GUARDS)!
      expect([...child.get('a')!]).toEqual([GuardA, GuardB])
      expect([...child.get('b')!]).toEqual([GuardA])
    })

    it('a subclass controller serves its own routes without adding them to the parent', async () => {
      @Controller('/base')
      class BaseController {
        @Get('a')
        a() {
          return { route: 'a' }
        }
      }

      @Controller('/child')
      class ChildController extends BaseController {
        @Get('b')
        b() {
          return { route: 'b' }
        }
      }

      @Module({ controllers: [BaseController, ChildController] })
      class AppModule {}

      expect(getMeta<RouteDefinition[]>(BaseController, ROUTES)!.map((r) => r.handlerName)).toEqual(['a'])

      const app = new Miia({ logger: false }).register(AppModule)
      const request = (path: string) => app.fetch(new Request(`http://localhost${path}`))

      expect(await (await request('/base/a')).json()).toEqual({ route: 'a' })
      expect((await request('/base/b')).status).toBe(404)
      expect(await (await request('/child/a')).json()).toEqual({ route: 'a' })
      expect(await (await request('/child/b')).json()).toEqual({ route: 'b' })
      await app.destroy()
    })
  })

  describe('a handler overridden in a subclass', () => {
    function tagged(tag: string) {
      const schema = {
        calls: 0,
        safeParse(data: unknown) {
          schema.calls++
          return { success: true as const, data: { tag, data } }
        },
      }
      return schema
    }

    class Deny {
      canActivate() {
        return false
      }
    }

    class Allow {
      canActivate() {
        return true
      }
    }

    const routesOf = (controller: Constructor) =>
      getMeta<RouteDefinition[]>(controller, ROUTES)!.map((r) => `${r.method} ${r.path} ${r.handlerName}`)
    const schemaOf = (controller: Constructor, slot: symbol, handlerName: string) =>
      getMeta<Map<string, ZodLike>>(controller, slot)?.get(handlerName)

    function serve(...controllers: Constructor[]) {
      @Module({ controllers })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      const request = (method: string, path: string, body?: unknown) =>
        app.fetch(
          new Request(`http://localhost${path}`, {
            method,
            body: body === undefined ? undefined : JSON.stringify(body),
            headers: body === undefined ? {} : { 'content-type': 'application/json' },
          }),
        )
      return { app, request }
    }

    it('route decorators on the override replace the body schema it inherited', async () => {
      const baseBody = tagged('base')
      const subBody = tagged('sub')

      class Base {
        @Post('/', { body: baseBody })
        async create(ctx: RequestContext) {
          return ctx.json()
        }
      }

      @Controller('/items')
      class Items extends Base {
        @Post('/', { body: subBody })
        override async create(ctx: RequestContext) {
          return ctx.json()
        }
      }

      expect(routesOf(Items)).toEqual(['POST / create'])
      expect(routesOf(Base)).toEqual(['POST / create'])
      expect(schemaOf(Base, BODY_SCHEMAS, 'create')).toBe(baseBody)

      const { app, request } = serve(Items)
      expect(await (await request('POST', '/items', { a: 1 })).json()).toEqual({ tag: 'sub', data: { a: 1 } })
      expect(baseBody.calls).toBe(0)
      await app.destroy()
    })

    it('an override that repeats the inherited route serves it once, from the subclass', async () => {
      class Base {
        @Get(':id')
        find(ctx: RequestContext) {
          return { from: 'base', id: ctx.params.id }
        }
      }

      @Controller('/items')
      class Items extends Base {
        @Get(':id')
        override find(ctx: RequestContext) {
          return { from: 'sub', id: ctx.params.id }
        }
      }

      expect(routesOf(Items)).toEqual(['GET :id find'])

      const { app, request } = serve(Items)
      expect(await (await request('GET', '/items/1')).json()).toEqual({ from: 'sub', id: '1' })
      await app.destroy()
    })

    it('an override with another path serves only the new one', async () => {
      class Base {
        @Get(':id')
        find(ctx: RequestContext) {
          return { from: 'base', id: ctx.params.id }
        }
      }

      @Controller('/items')
      class Items extends Base {
        @Get('by/:id')
        override find(ctx: RequestContext) {
          return { from: 'sub', id: ctx.params.id }
        }
      }

      const { app, request } = serve(Items)
      expect((await request('GET', '/items/1')).status).toBe(404)
      expect(await (await request('GET', '/items/by/1')).json()).toEqual({ from: 'sub', id: '1' })
      await app.destroy()
    })

    it('an override without route decorators keeps the routes and schemas it inherited', async () => {
      const query = tagged('base')

      class Base {
        @Get(':id', { query })
        find(ctx: RequestContext) {
          return { from: 'base', query: ctx.query }
        }
      }

      @Controller('/items')
      class Items extends Base {
        override find(ctx: RequestContext) {
          return { from: 'sub', query: ctx.query }
        }
      }

      expect(routesOf(Items)).toEqual(['GET :id find'])

      const { app, request } = serve(Items)
      expect(await (await request('GET', '/items/1?page=2')).json()).toEqual({
        from: 'sub',
        query: { tag: 'base', data: { page: '2' } },
      })
      await app.destroy()
    })

    it('an override can change the method, with or without a body schema', async () => {
      const body = tagged('sub')

      class ReadBase {
        @Get(':id')
        find(ctx: RequestContext): unknown {
          return { from: 'base', id: ctx.params.id }
        }
      }

      @Controller('/write')
      class Write extends ReadBase {
        @Post(':id', { body })
        override async find(ctx: RequestContext) {
          return ctx.json()
        }
      }

      class WriteBase {
        @Post(':id', { body: tagged('base') })
        async update(ctx: RequestContext) {
          return ctx.json()
        }
      }

      @Controller('/read')
      class Read extends WriteBase {
        @Get(':id')
        override async update(ctx: RequestContext) {
          return { from: 'sub', id: ctx.params.id }
        }
      }

      expect(routesOf(Write)).toEqual(['POST :id find'])
      expect(routesOf(Read)).toEqual(['GET :id update'])
      expect(schemaOf(Read, BODY_SCHEMAS, 'update')).toBeUndefined()
      expect(schemaOf(WriteBase, BODY_SCHEMAS, 'update')).toBeDefined()

      const { app, request } = serve(Write, Read)
      expect(await (await request('POST', '/write/1', { a: 1 })).json()).toEqual({ tag: 'sub', data: { a: 1 } })
      expect((await request('GET', '/write/1')).status).toBe(404)
      expect(await (await request('GET', '/read/1')).json()).toEqual({ from: 'sub', id: '1' })
      await app.destroy()
    })

    it('stacked routes on the override share its schemas and may still not disagree', async () => {
      const baseQuery = tagged('base')
      const subQuery = tagged('sub')

      class Base {
        @Get(':id', { query: baseQuery })
        find(ctx: RequestContext): unknown {
          return ctx.query
        }
      }

      @Controller('/items')
      class Items extends Base {
        @Get('a')
        @Get('b', { query: subQuery })
        override find(ctx: RequestContext) {
          return ctx.query
        }
      }

      expect(routesOf(Items)).toEqual(['GET b find', 'GET a find'])

      const { app, request } = serve(Items)
      expect(await (await request('GET', '/items/a?x=1')).json()).toEqual({ tag: 'sub', data: { x: '1' } })
      expect(await (await request('GET', '/items/b?x=2')).json()).toEqual({ tag: 'sub', data: { x: '2' } })
      expect(baseQuery.calls).toBe(0)
      await app.destroy()

      expect(() => {
        class Mixed extends Base {
          @Get('a', { query: baseQuery })
          @Get('b', { query: subQuery })
          override find() {}
        }
        return Mixed
      }).toThrow("@Get declares a different query schema than another route on handler 'find'")
    })

    it('guards still accumulate across an override, route decorators or not', async () => {
      @Controller('/base')
      class Base {
        @UseGuard(Deny)
        @Get('g')
        g() {
          return { from: 'base' }
        }
      }

      @Controller('/plain')
      class Plain extends Base {
        @UseGuard(Allow)
        override g() {
          return { from: 'sub' }
        }
      }

      @Controller('/moved')
      class Moved extends Base {
        @UseGuard(Allow)
        @Get('moved')
        override g() {
          return { from: 'sub' }
        }
      }

      const { app, request } = serve(Base, Plain, Moved)
      expect((await request('GET', '/base/g')).status).toBe(403)
      expect((await request('GET', '/plain/g')).status).toBe(403)
      expect((await request('GET', '/moved/moved')).status).toBe(403)
      expect((await request('GET', '/moved/g')).status).toBe(404)
      await app.destroy()
    })

    it('@SkipGuard on the override removes a guard it inherited', async () => {
      @Controller('/base')
      class Base {
        @UseGuard(Deny)
        @Get('g')
        g() {
          return { from: 'base' }
        }
      }

      @Controller('/open')
      class Open extends Base {
        @SkipGuard(Deny)
        override g() {
          return { from: 'sub' }
        }
      }

      @Controller('/moved')
      class Moved extends Base {
        @SkipGuard(Deny)
        @Get('moved')
        override g() {
          return { from: 'sub' }
        }
      }

      const { app, request } = serve(Base, Open, Moved)
      expect((await request('GET', '/base/g')).status).toBe(403)
      expect(await (await request('GET', '/open/g')).json()).toEqual({ from: 'sub' })
      expect(await (await request('GET', '/moved/moved')).json()).toEqual({ from: 'sub' })
      await app.destroy()
    })

    it('replaces level by level and leaves every ancestor as it was', async () => {
      const params = tagged('a')
      const body = tagged('d')

      @Controller('/a')
      class A {
        @Get('/')
        list() {
          return { from: 'a' }
        }

        @Get(':id', { params })
        find(ctx: RequestContext): unknown {
          return { from: 'a', params: ctx.params }
        }
      }

      @Controller('/b')
      class B extends A {
        @Get('extra')
        extra() {
          return { from: 'b' }
        }

        @Get('b/:id')
        override find(ctx: RequestContext): unknown {
          return { from: 'b', params: ctx.params }
        }
      }

      @Controller('/c')
      class C extends B {}

      @Controller('/d')
      class D extends B {
        @Post('d/:id', { body })
        override async find(ctx: RequestContext) {
          return ctx.json()
        }
      }

      expect(routesOf(A)).toEqual(['GET / list', 'GET :id find'])
      expect(routesOf(B)).toEqual(['GET / list', 'GET extra extra', 'GET b/:id find'])
      expect(routesOf(C)).toEqual(routesOf(B))
      expect(routesOf(D)).toEqual(['GET / list', 'GET extra extra', 'POST d/:id find'])
      expect(schemaOf(A, PARAMS_SCHEMAS, 'find')).toBe(params)
      expect(schemaOf(B, PARAMS_SCHEMAS, 'find')).toBeUndefined()
      expect(schemaOf(B, BODY_SCHEMAS, 'find')).toBeUndefined()

      const { app, request } = serve(A, B, C, D)
      expect(await (await request('GET', '/a/1')).json()).toEqual({
        from: 'a',
        params: { tag: 'a', data: { id: '1' } },
      })
      expect(await (await request('GET', '/b/b/1')).json()).toEqual({ from: 'b', params: { id: '1' } })
      expect(await (await request('GET', '/c/b/1')).json()).toEqual({ from: 'b', params: { id: '1' } })
      expect((await request('GET', '/c/1')).status).toBe(404)
      expect(await (await request('POST', '/d/d/1', { a: 1 })).json()).toEqual({ tag: 'd', data: { a: 1 } })
      expect((await request('GET', '/d/b/1')).status).toBe(404)
      expect(params.calls).toBe(1)
      await app.destroy()
    })

    it('sibling subclasses override the same handler independently', () => {
      const query = tagged('base')
      const rightParams = tagged('right')

      class Base {
        @Get(':id', { query })
        find() {}
      }

      class Left extends Base {
        @Get('left/:id')
        override find() {}
      }

      class Right extends Base {
        @Get('right/:id', { params: rightParams })
        override find() {}
      }

      class Same extends Base {}

      expect(routesOf(Base)).toEqual(['GET :id find'])
      expect(routesOf(Left)).toEqual(['GET left/:id find'])
      expect(routesOf(Right)).toEqual(['GET right/:id find'])
      expect(routesOf(Same)).toEqual(['GET :id find'])
      expect(schemaOf(Base, QUERY_SCHEMAS, 'find')).toBe(query)
      expect(schemaOf(Base, PARAMS_SCHEMAS, 'find')).toBeUndefined()
      expect(schemaOf(Left, QUERY_SCHEMAS, 'find')).toBeUndefined()
      expect(schemaOf(Right, QUERY_SCHEMAS, 'find')).toBeUndefined()
      expect(schemaOf(Right, PARAMS_SCHEMAS, 'find')).toBe(rightParams)
      expect(schemaOf(Same, QUERY_SCHEMAS, 'find')).toBe(query)
    })
  })
})
