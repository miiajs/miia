import { describe, expect, it } from 'bun:test'
import { Controller, Get, Injectable, Module, SkipGuard } from '../src/decorators/index.js'
import { getMeta, INJECTABLE, PREFIX, MODULE, ROUTES, SKIP_GUARDS } from '../src/decorators/index.js'
import { addToMapMeta, createMethodDecorator, pushMeta, setInMapMeta } from '../src/decorators/index.js'
import type { InjectableMeta } from '../src/decorators/index.js'
import { Miia } from '../src/index.js'
import type { ModuleOptions, RouteDefinition } from '../src/types.js'

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
})
