import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import type { CanActivate, RequestContext } from '@miiajs/core'
import { Controller, Get, Post, Status, UseGuard, ValidateBody, ValidateQuery } from '@miiajs/core'
import {
  ApiBody,
  ApiExclude,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTag,
  SpecBuilder,
} from '../src/index.js'

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
})

const SearchSchema = z.object({
  q: z.string().describe('Search query'),
  limit: z.number().int().optional(),
})

class MockGuard implements CanActivate {
  canActivate() {
    return true
  }
}

describe('SpecBuilder', () => {
  it('should generate basic spec from controller', () => {
    @Controller('/users')
    class UserController {
      @Get('/')
      list(_ctx: RequestContext) {}

      @Get('/:id')
      findOne(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], {
      title: 'Test API',
      version: '1.0.0',
    })

    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('Test API')
    expect(spec.paths['/users']).toBeDefined()
    expect(spec.paths['/users']).toHaveProperty('get')
    expect(spec.paths['/users/{id}']).toBeDefined()
    expect(spec.paths['/users/{id}']).toHaveProperty('get')
  })

  it('should auto-detect path params', () => {
    @Controller('/users')
    class UserController {
      @Get('/:id')
      findOne(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    const params = spec.paths['/users/{id}'].get.parameters
    expect(params).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }])
  })

  it('should use @ApiTag for tags', () => {
    @ApiTag('Users', 'Admin')
    @Controller('/users')
    class UserController {
      @Get('/')
      list(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    expect(spec.paths['/users'].get.tags).toEqual(['Users', 'Admin'])
    expect(spec.tags).toContainEqual({ name: 'Users' })
    expect(spec.tags).toContainEqual({ name: 'Admin' })
  })

  it('should fallback tag to controller name', () => {
    @Controller('/items')
    class ItemController {
      @Get('/')
      list(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: ItemController, prefix: 'items' }], { title: 'Test', version: '1.0.0' })

    expect(spec.paths['/items'].get.tags).toEqual(['Item'])
  })

  it('should include @ApiOperation metadata', () => {
    @Controller('/users')
    class UserController {
      @ApiOperation({ summary: 'Get all users', description: 'Returns a list' })
      @Get('/')
      list(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    expect(spec.paths['/users'].get.summary).toBe('Get all users')
    expect(spec.paths['/users'].get.description).toBe('Returns a list')
  })

  it('should auto-extract body schema from @ValidateBody', () => {
    @Controller('/users')
    class UserController {
      @Post('/')
      @Status(201)
      @ValidateBody(CreateUserSchema)
      create(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    const op = spec.paths['/users'].post
    expect(op.requestBody).toBeDefined()
    expect(op.requestBody.content['application/json'].schema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
      },
      required: ['name', 'email', 'password'],
    })
  })

  it('should support multipart/form-data via @ApiBody options', () => {
    @Controller('/users')
    class UserController {
      @Post('/:id/avatar')
      @ApiBody(
        {
          type: 'object',
          properties: { file: { type: 'string', format: 'binary' } },
          required: ['file'],
        },
        { contentType: 'multipart/form-data' },
      )
      upload(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    const op = spec.paths['/users/{id}/avatar'].post
    expect(op.requestBody).toBeDefined()
    expect(op.requestBody.required).toBe(true)
    expect(op.requestBody.content['multipart/form-data']).toBeDefined()
    expect(op.requestBody.content['multipart/form-data'].schema).toEqual({
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    })
    expect(op.requestBody.content['application/json']).toBeUndefined()
  })

  it('should respect required:false and description in @ApiBody options', () => {
    @Controller('/users')
    class UserController {
      @Post('/')
      @ApiBody(CreateUserSchema, { required: false, description: 'Optional payload' })
      create(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    const op = spec.paths['/users'].post
    expect(op.requestBody.required).toBe(false)
    expect(op.requestBody.description).toBe('Optional payload')
    expect(op.requestBody.content['application/json']).toBeDefined()
  })

  it('should use custom status from @Status', () => {
    @Controller('/users')
    class UserController {
      @Post('/')
      @Status(201)
      @ValidateBody(CreateUserSchema)
      create(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    expect(spec.paths['/users'].post.responses['201']).toBeDefined()
    expect(spec.paths['/users'].post.responses['201'].description).toBe('Created')
  })

  it('should auto-add 422 when validation is present', () => {
    @Controller('/users')
    class UserController {
      @Post('/')
      @ValidateBody(CreateUserSchema)
      create(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    expect(spec.paths['/users'].post.responses['422']).toEqual({ description: 'Unprocessable Entity' })
  })

  it('should auto-add 403 when guards are present', () => {
    @Controller('/users')
    @UseGuard(MockGuard)
    class UserController {
      @Get('/')
      list(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    expect(spec.paths['/users'].get.responses['403']).toEqual({ description: 'Forbidden' })
  })

  it('should include explicit @ApiResponse', () => {
    @Controller('/users')
    class UserController {
      @ApiResponse(200, { description: 'Success', schema: z.object({ id: z.string() }) })
      @ApiResponse(404, { description: 'User not found' })
      @Get('/:id')
      findOne(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    const responses = spec.paths['/users/{id}'].get.responses
    expect(responses['200'].description).toBe('Success')
    expect(responses['200'].content['application/json'].schema).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    })
    expect(responses['404'].description).toBe('User not found')
  })

  it('should include @ApiSecurity', () => {
    @ApiSecurity('bearer')
    @Controller('/users')
    class UserController {
      @Get('/')
      list(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    expect(spec.paths['/users'].get.security).toEqual([{ bearer: [] }])
  })

  it('should auto-extract query params from @ValidateQuery', () => {
    @Controller('/search')
    class SearchController {
      @Get('/')
      @ValidateQuery(SearchSchema)
      search(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: SearchController, prefix: 'search' }], {
      title: 'Test',
      version: '1.0.0',
    })

    const params = spec.paths['/search'].get.parameters
    expect(params).toContainEqual({
      name: 'q',
      in: 'query',
      required: true,
      description: 'Search query',
      schema: { type: 'string', description: 'Search query' },
    })
    expect(params).toContainEqual({
      name: 'limit',
      in: 'query',
      schema: { type: 'integer' },
    })
  })

  it('should exclude class with @ApiExclude', () => {
    @ApiExclude()
    @Controller('/internal')
    class InternalController {
      @Get('/')
      status(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: InternalController, prefix: 'internal' }], {
      title: 'Test',
      version: '1.0.0',
    })

    expect(spec.paths).toEqual({})
  })

  it('should exclude method with @ApiExclude', () => {
    @Controller('/users')
    class UserController {
      @Get('/')
      list(_ctx: RequestContext) {}

      @ApiExclude()
      @Get('/debug')
      debug(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    expect(spec.paths['/users']).toBeDefined()
    expect(spec.paths['/users/debug']).toBeUndefined()
  })

  it('should explicit @ApiParam override auto-inferred', () => {
    @Controller('/users')
    class UserController {
      @ApiParam('id', { description: 'User UUID', schema: { type: 'string', format: 'uuid' } })
      @Get('/:id')
      findOne(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: UserController, prefix: 'users' }], { title: 'Test', version: '1.0.0' })

    const params = spec.paths['/users/{id}'].get.parameters
    expect(params).toHaveLength(1)
    expect(params[0]).toEqual({
      name: 'id',
      in: 'path',
      required: true,
      description: 'User UUID',
      schema: { type: 'string', format: 'uuid' },
    })
  })

  it('should include securitySchemes and servers from options', () => {
    @Controller('/')
    class TestCtrl {
      @Get('/')
      index(_ctx: RequestContext) {}
    }

    const builder = new SpecBuilder()
    const spec = builder.build([{ controller: TestCtrl, prefix: '' }], {
      title: 'Test',
      version: '1.0.0',
      servers: [{ url: 'https://api.example.com', description: 'Production' }],
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    })

    expect(spec.servers).toEqual([{ url: 'https://api.example.com', description: 'Production' }])
    expect(spec.components.securitySchemes.bearer).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
  })
})
