import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import type { CanActivate, RequestContext } from '@miiajs/core'
import { Controller, Get, Module, Post, Status, ValidateBody } from '@miiajs/core'
import { TestApp } from '@miiajs/core/testing'
import { ApiOperation, ApiTag, SwaggerModule } from '../src/index.js'

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

@ApiTag('Users')
@Controller('/users')
class UserController {
  @Get('/')
  @ApiOperation({ summary: 'List users' })
  list(_ctx: RequestContext) {
    return []
  }

  @Post('/')
  @Status(201)
  @ValidateBody(CreateUserSchema)
  @ApiOperation({ summary: 'Create user' })
  create(_ctx: RequestContext) {
    return { id: '1' }
  }

  @Get('/:id')
  findOne(_ctx: RequestContext) {
    return { id: '1' }
  }
}

@Module({
  imports: [SwaggerModule.configure({ title: 'Test API', version: '1.0.0' })],
  controllers: [UserController],
})
class AppModule {}

describe('SwaggerModule', () => {
  it('serves the OpenAPI spec at /docs/json', async () => {
    const app = await TestApp.create(AppModule).compile()

    const res = await app.request('GET', '/docs/json')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')

    const spec = await res.json()
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('Test API')
    expect(spec.paths['/users']).toBeDefined()
    expect(spec.paths['/users'].get.summary).toBe('List users')
    expect(spec.paths['/users'].post.requestBody).toBeDefined()
    expect(spec.paths['/users/{id}']).toBeDefined()

    await app.close()
  })

  it('serves Swagger UI assets at /docs', async () => {
    const app = await TestApp.create(AppModule).compile()

    const res = await app.request('GET', '/docs/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')

    const html = await res.text()
    expect(html).toContain('swagger-ui')

    const initRes = await app.request('GET', '/docs/swagger-initializer.js')
    expect(initRes.status).toBe(200)
    const initJs = await initRes.text()
    expect(initJs).toContain('/docs/json')

    await app.close()
  })

  it('honors custom path and uiPath options', async () => {
    @Module({
      imports: [
        SwaggerModule.configure({
          title: 'Test',
          version: '1.0.0',
          path: '/api-spec',
          uiPath: '/api-docs',
        }),
      ],
      controllers: [UserController],
    })
    class CustomPathsModule {}

    const app = await TestApp.create(CustomPathsModule).compile()

    const specRes = await app.request('GET', '/api-spec')
    expect(specRes.status).toBe(200)

    const uiRes = await app.request('GET', '/api-docs/')
    expect(uiRes.status).toBe(200)

    const initRes = await app.request('GET', '/api-docs/swagger-initializer.js')
    const initJs = await initRes.text()
    expect(initJs).toContain('/api-spec')

    await app.close()
  })

  it('does not serve UI when ui: false', async () => {
    @Module({
      imports: [SwaggerModule.configure({ title: 'Test', version: '1.0.0', ui: false })],
      controllers: [UserController],
    })
    class NoUiModule {}

    const app = await TestApp.create(NoUiModule).compile()

    const specRes = await app.request('GET', '/docs/json')
    expect(specRes.status).toBe(200)

    const uiRes = await app.request('GET', '/docs')
    expect(uiRes.status).toBe(404)

    await app.close()
  })

  it('swagger routes receive global middleware but skip global guards', async () => {
    const mwCalls: string[] = []
    let guardCalls = 0

    class BlockingGuard implements CanActivate {
      canActivate(_ctx: RequestContext): boolean {
        guardCalls++
        return false
      }
    }

    const app = await TestApp.create(AppModule)
      .use(async (_ctx, next) => {
        mwCalls.push('global-mw')
        await next()
      })
      .useGuard(BlockingGuard)
      .compile()

    // Swagger spec endpoint: global middleware runs (observability), guard does NOT (UI stays reachable)
    const specRes = await app.request('GET', '/docs/json')
    expect(specRes.status).toBe(200)
    expect(mwCalls).toEqual(['global-mw'])
    expect(guardCalls).toBe(0)

    // Regular route: both middleware and guard run
    const usersRes = await app.request('GET', '/users')
    expect(usersRes.status).toBe(403)
    expect(mwCalls).toEqual(['global-mw', 'global-mw'])
    expect(guardCalls).toBe(1)

    await app.close()
  })

  it('generates spec paths with the module-level prefix applied to controllers', async () => {
    @Module({ prefix: '/api/v1', controllers: [UserController] })
    class ApiModule {}

    @Module({
      imports: [ApiModule, SwaggerModule.configure({ title: 'Prefixed', version: '1.0.0' })],
    })
    class PrefixedApp {}

    const app = await TestApp.create(PrefixedApp).compile()

    const res = await app.request('GET', '/docs/json')
    expect(res.status).toBe(200)

    const spec = await res.json()
    expect(spec.paths['/api/v1/users']).toBeDefined()
    expect(spec.paths['/api/v1/users/{id}']).toBeDefined()
    // Unprefixed path must NOT be present - this is the regression guard
    expect(spec.paths['/users']).toBeUndefined()

    await app.close()
  })
})
