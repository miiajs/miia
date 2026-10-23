import { describe, expect, it } from 'bun:test'
import { Controller, createToken, Get, Post, Module, Injectable, UseGuard, inject, REQUEST_CONTEXT } from '@miiajs/core'
import type { CanActivate, ConfiguredModule, RequestContext, Guard, Middleware } from '@miiajs/core'
import { ForbiddenException, Logger } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'

// ─── Test fixtures ───────────────────────────────────────────────

@Injectable()
class UserService {
  findAll() {
    return [{ id: 1, name: 'Real User' }]
  }

  findById(id: string) {
    return { id, name: 'Real User' }
  }

  create(data: any) {
    return { id: '1', ...data }
  }
}

@Controller('/users')
class UserController {
  private userService = inject(UserService)

  @Get('/')
  findAll(_ctx: RequestContext) {
    return this.userService.findAll()
  }

  @Get('/:id')
  findOne(ctx: RequestContext) {
    return this.userService.findById(ctx.params.id)
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const body = await ctx.json<{ name: string }>()
    return this.userService.create(body)
  }
}

@Module({
  controllers: [UserController],
  providers: [UserService],
})
class AppModule {}

// ─── Factory provider fixtures ───────────────────────────────────

const DB_TOKEN = createToken<{ query: () => string }>('DATABASE')

@Controller('/data')
class DataController {
  private db = inject(DB_TOKEN)

  @Get('/')
  getData(_ctx: RequestContext) {
    return { result: this.db.query() }
  }
}

@Module({
  controllers: [DataController],
  providers: [{ token: DB_TOKEN, factory: () => ({ query: () => 'real-data' }) }],
})
class DataModule {}

// ─── Guard fixtures ──────────────────────────────────────────────

function TestGuard(): Guard {
  class TGuard implements CanActivate {
    canActivate(ctx: RequestContext): boolean {
      if (ctx.req.headers.get('x-test') !== 'pass') {
        throw new ForbiddenException('Blocked')
      }
      return true
    }
  }
  return TGuard
}

// ─── Tests ───────────────────────────────────────────────────────

describe('TestApp', () => {
  describe('basic usage', () => {
    it('should create app and handle requests', async () => {
      const app = await TestApp.create(AppModule).compile()

      const res = await app.request('GET', '/users/')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([{ id: 1, name: 'Real User' }])

      await app.close()
    })

    it('should handle request with params', async () => {
      const app = await TestApp.create(AppModule).compile()

      const res = await app.request('GET', '/users/42')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ id: '42', name: 'Real User' })

      await app.close()
    })

    it('should handle request with body', async () => {
      const app = await TestApp.create(AppModule).compile()

      const res = await app.request('POST', '/users/', {
        body: { name: 'New User' },
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ id: '1', name: 'New User' })

      await app.close()
    })

    it('should handle request with query params', async () => {
      const app = await TestApp.create(AppModule).compile()

      const res = await app.request('GET', '/users/', {
        query: { role: 'admin' },
      })
      expect(res.status).toBe(200)

      await app.close()
    })
  })

  describe('override class provider', () => {
    it('should use mock service', async () => {
      const app = await TestApp.create(AppModule)
        .override(UserService, {
          findAll: () => [{ id: 99, name: 'Mock User' }],
          findById: (id: string) => ({ id, name: 'Mock User' }),
          create: () => null,
        })
        .compile()

      const res = await app.request('GET', '/users/')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([{ id: 99, name: 'Mock User' }])

      await app.close()
    })

    it('should return mock from resolve()', async () => {
      const mockService = {
        findAll: () => [],
        findById: (id: string) => ({ id, name: 'Mock User' }),
        create: () => null,
      }

      const app = await TestApp.create(AppModule).override(UserService, mockService).compile()

      const resolved = app.resolve(UserService)
      expect(resolved.findAll()).toEqual([])

      await app.close()
    })
  })

  describe('override factory provider', () => {
    it('should override factory-registered provider', async () => {
      const app = await TestApp.create(DataModule)
        .override(DB_TOKEN, { query: () => 'mock-data' })
        .compile()

      const res = await app.request('GET', '/data/')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ result: 'mock-data' })

      await app.close()
    })

    it('should override with factory function', async () => {
      const app = await TestApp.create(DataModule)
        .override(DB_TOKEN, () => ({ query: () => 'factory-mock' }))
        .compile()

      const res = await app.request('GET', '/data/')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ result: 'factory-mock' })

      await app.close()
    })
  })

  describe('override configured module', () => {
    const CONFIG = createToken<string>('CONFIG')

    function makeConfigLike() {
      class ConfigLikeModule {
        static configure(value: string): ConfiguredModule {
          return { module: ConfigLikeModule, providers: [{ token: CONFIG, factory: () => value }], exports: [CONFIG] }
        }
      }

      @Controller('/config')
      class ConfigController {
        private config = inject(CONFIG)

        @Get('/')
        read(_ctx: RequestContext) {
          return { config: this.config }
        }
      }

      @Module({ imports: [ConfigLikeModule], controllers: [ConfigController] })
      class FeatureModule {}

      @Module({ imports: [ConfigLikeModule.configure('production'), FeatureModule] })
      class RootModule {}

      return { ConfigLikeModule, FeatureModule, RootModule }
    }

    it('should replace the configuration the graph imports', async () => {
      const { ConfigLikeModule, RootModule } = makeConfigLike()
      const app = await TestApp.create(RootModule)
        .override(ConfigLikeModule, ConfigLikeModule.configure('test'))
        .compile()

      const res = await app.request('GET', '/config/')
      expect(await res.json()).toEqual({ config: 'test' })

      await app.close()
    })

    it('should configure a module a feature imports bare when registered alongside', async () => {
      const { ConfigLikeModule, FeatureModule } = makeConfigLike()
      const app = await TestApp.create(FeatureModule, ConfigLikeModule.configure('test')).compile()

      const res = await app.request('GET', '/config/')
      expect(await res.json()).toEqual({ config: 'test' })

      await app.close()
    })

    it('should reject a configured module of another class', () => {
      const { ConfigLikeModule } = makeConfigLike()
      class AnotherModule {}

      expect(() =>
        TestApp.create(AppModule).override(ConfigLikeModule, { module: AnotherModule, providers: [] }),
      ).toThrow(
        "[Miia] TestApp.override(ConfigLikeModule, ...): the configured module's class is AnotherModule, " +
          'not ConfigLikeModule',
      )
    })

    it('should treat a mock with a module function and no providers as a provider override', async () => {
      const mock = { module: () => 'mocked', findAll: () => [] }
      const app = await TestApp.create(AppModule).override(UserService, mock).compile()

      expect(app.resolve(UserService)).toBe(mock as unknown as UserService)

      await app.close()
    })
  })

  describe('override unknown token', () => {
    it('should reject a token no loaded module provides', async () => {
      await expect(TestApp.create(AppModule).override(createToken('MISSING'), {}).compile()).rejects.toThrow(
        '[Miia] override(MISSING): no loaded module provides MISSING - use provide() for a module-less test',
      )
    })
  })

  describe('override REQUEST_CONTEXT', () => {
    it('should reject it - every request seeds its own', async () => {
      await expect(TestApp.create(AppModule).override(REQUEST_CONTEXT, { params: {} }).compile()).rejects.toThrow(
        '[Miia] override(RequestContext): REQUEST_CONTEXT is built in and seeded by every request - it cannot be provided or overridden; test a request-scoped provider through a route with TestApp.request(), or override that provider itself',
      )
    })
  })

  describe('use() and useGuard()', () => {
    it('should apply global middleware', async () => {
      const mw: Middleware = async (ctx, next) => {
        ctx.res.header('X-Custom', 'test')
        await next()
      }

      const app = await TestApp.create(AppModule).use(mw).compile()

      const res = await app.request('GET', '/users/')
      expect(res.headers.get('X-Custom')).toBe('test')

      await app.close()
    })

    it('should apply global guard', async () => {
      const app = await TestApp.create(AppModule).useGuard(TestGuard()).compile()

      const blocked = await app.request('GET', '/users/')
      expect(blocked.status).toBe(403)

      const passed = await app.request('GET', '/users/', {
        headers: { 'x-test': 'pass' },
      })
      expect(passed.status).toBe(200)

      await app.close()
    })
  })

  describe('setGlobalPrefix()', () => {
    it('should prefix every route of the app', async () => {
      const app = await TestApp.create(AppModule).setGlobalPrefix('/api').compile()

      const prefixed = await app.request('GET', '/api/users/')
      expect(prefixed.status).toBe(200)
      expect(await prefixed.json()).toEqual([{ id: 1, name: 'Real User' }])

      const unprefixed = await app.request('GET', '/users/')
      expect(unprefixed.status).toBe(404)

      await app.close()
    })
  })

  describe('close()', () => {
    it('should cleanup without errors', async () => {
      const app = await TestApp.create(AppModule).compile()
      await app.close()
    })

    it('hands the global logger back: logs from outside the test app are silenced only while it lives', async () => {
      const lines: string[] = []
      const previous = Logger.getLogger()
      Logger.setLogger({
        log: (message) => lines.push(message),
        error() {},
        warn() {},
      })
      try {
        const app = await TestApp.create(AppModule).compile()
        new Logger('Other').log('during')
        await app.close()
        new Logger('Other').log('after')
        expect(lines).toEqual(['after'])
      } finally {
        Logger.setLogger(previous)
      }
    })

    it('hands the global logger back when compile() throws', async () => {
      @Injectable()
      class Broken {
        onInit() {
          throw new Error('boom')
        }
      }
      @Module({ providers: [Broken] })
      class BrokenModule {}

      const lines: string[] = []
      const previous = Logger.getLogger()
      Logger.setLogger({
        log: (message) => lines.push(message),
        error() {},
        warn() {},
      })
      try {
        await expect(TestApp.create(BrokenModule).compile()).rejects.toThrow('boom')
        new Logger('Other').log('after')
        expect(lines).toEqual(['after'])
      } finally {
        Logger.setLogger(previous)
      }
    })
  })

  describe('builder lifecycle', () => {
    it('should reject builder calls after compile()', async () => {
      const app = await TestApp.create(AppModule).compile()

      expect(() => app.use(async (_ctx, next) => next())).toThrow('[Miia] TestApp: use() after compile()')
      expect(() => app.override(UserService, {})).toThrow('[Miia] TestApp: override() after compile()')
      expect(() => app.setGlobalPrefix('/api')).toThrow('[Miia] TestApp: setGlobalPrefix() after compile()')

      await app.close()
    })

    it('should reject a second compile()', async () => {
      const app = await TestApp.create(AppModule).compile()

      await expect(app.compile()).rejects.toThrow('[Miia] TestApp: compile() after compile()')

      await app.close()
    })

    it('should reject request(), resolve() and close() before compile()', async () => {
      const app = TestApp.create(AppModule)

      await expect(app.request('GET', '/users/')).rejects.toThrow('[Miia] TestApp: call compile() first')
      expect(() => app.resolve(UserService)).toThrow('[Miia] TestApp: call compile() first')
      await expect(app.close()).rejects.toThrow('[Miia] TestApp: call compile() first')
    })
  })
})
