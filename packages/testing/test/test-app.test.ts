import { describe, expect, it } from 'bun:test'
import { Controller, Get, Post, Module, Injectable, UseGuard, ValidateBody, inject } from '@miiajs/core'
import type { CanActivate, RequestContext, Guard, Middleware } from '@miiajs/core'
import { ForbiddenException } from '@miiajs/core'
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

const DB_TOKEN = 'DATABASE'

@Controller('/data')
class DataController {
  private db = inject<{ query: () => string }>(DB_TOKEN)

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
          findById: () => null,
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
        findById: () => null,
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

  describe('close()', () => {
    it('should cleanup without errors', async () => {
      const app = await TestApp.create(AppModule).compile()
      await app.close()
    })
  })
})
