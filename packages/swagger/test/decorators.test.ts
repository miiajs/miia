import { describe, expect, it } from 'bun:test'
import { Controller, Get, getMeta } from '@miiajs/core'
import {
  ApiExclude,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTag,
} from '../src/index.js'
import {
  API_EXCLUDE,
  API_HEADERS,
  API_OPERATIONS,
  API_PARAMS,
  API_QUERIES,
  API_RESPONSES,
  API_SECURITY,
  API_TAG,
} from '../src/constants.js'

describe('Swagger Decorators', () => {
  it('@ApiTag should store tags as string[]', () => {
    @ApiTag('Users', 'Admin')
    @Controller('/users')
    class TestCtrl {
      @Get('/')
      list() {}
    }

    expect(getMeta<string[]>(TestCtrl, API_TAG)).toEqual(['Users', 'Admin'])
  })

  it('@ApiOperation should store operation metadata per method', () => {
    @Controller('/')
    class TestCtrl {
      @ApiOperation({ summary: 'List items', description: 'Get all items' })
      @Get('/')
      list() {}
    }

    const map = getMeta<Map<string, any>>(TestCtrl, API_OPERATIONS)
    expect(map?.get('list')).toEqual({ summary: 'List items', description: 'Get all items' })
  })

  it('@ApiResponse should store multiple responses per method', () => {
    @Controller('/')
    class TestCtrl {
      @ApiResponse(200, { description: 'Success' })
      @ApiResponse(404, { description: 'Not found' })
      @Get('/:id')
      findOne() {}
    }

    const map = getMeta<Map<string, any[]>>(TestCtrl, API_RESPONSES)
    const responses = map?.get('findOne')
    expect(responses).toHaveLength(2)
    expect(responses).toContainEqual({ status: 200, description: 'Success' })
    expect(responses).toContainEqual({ status: 404, description: 'Not found' })
  })

  it('@ApiParam should store param metadata', () => {
    @Controller('/')
    class TestCtrl {
      @ApiParam('id', { description: 'User ID' })
      @Get('/:id')
      findOne() {}
    }

    const map = getMeta<Map<string, any[]>>(TestCtrl, API_PARAMS)
    expect(map?.get('findOne')).toEqual([{ name: 'id', description: 'User ID' }])
  })

  it('@ApiQuery should store query metadata', () => {
    @Controller('/')
    class TestCtrl {
      @ApiQuery('limit', { description: 'Max results', required: false })
      @Get('/')
      list() {}
    }

    const map = getMeta<Map<string, any[]>>(TestCtrl, API_QUERIES)
    expect(map?.get('list')).toEqual([{ name: 'limit', description: 'Max results', required: false }])
  })

  it('@ApiSecurity should store class-level security', () => {
    @ApiSecurity('bearer')
    @Controller('/')
    class TestCtrl {
      @Get('/')
      list() {}
    }

    const meta = getMeta<Map<string, any[]>>(TestCtrl, API_SECURITY)
    expect(meta?.get('*')).toEqual([{ name: 'bearer', scopes: [] }])
  })

  it('@ApiSecurity should store method-level security', () => {
    @Controller('/')
    class TestCtrl {
      @ApiSecurity('bearer', ['read'])
      @Get('/')
      list() {}
    }

    const meta = getMeta<Map<string, any[]>>(TestCtrl, API_SECURITY)
    expect(meta?.get('list')).toEqual([{ name: 'bearer', scopes: ['read'] }])
  })

  it('@ApiSecurity should support class + method combined', () => {
    @ApiSecurity('bearer')
    @Controller('/')
    class TestCtrl {
      @ApiSecurity('admin', ['write'])
      @Get('/')
      list() {}

      @Get('/public')
      pub() {}
    }

    const meta = getMeta<Map<string, any[]>>(TestCtrl, API_SECURITY)
    expect(meta?.get('*')).toEqual([{ name: 'bearer', scopes: [] }])
    expect(meta?.get('list')).toEqual([{ name: 'admin', scopes: ['write'] }])
    expect(meta?.has('pub')).toBe(false)
  })

  it('@ApiHeader should store class-level headers', () => {
    @ApiHeader('X-Api-Key', { required: true })
    @Controller('/')
    class TestCtrl {
      @Get('/')
      list() {}
    }

    const meta = getMeta<Map<string, any[]>>(TestCtrl, API_HEADERS)
    expect(meta?.get('*')).toEqual([{ name: 'X-Api-Key', required: true }])
  })

  it('@ApiHeader should support class + method combined', () => {
    @ApiHeader('X-Api-Key', { required: true })
    @Controller('/')
    class TestCtrl {
      @ApiHeader('X-Request-Id')
      @Get('/')
      list() {}
    }

    const meta = getMeta<Map<string, any[]>>(TestCtrl, API_HEADERS)
    expect(meta?.get('*')).toEqual([{ name: 'X-Api-Key', required: true }])
    expect(meta?.get('list')).toEqual([{ name: 'X-Request-Id' }])
  })

  it('@ApiExclude should mark class as excluded', () => {
    @ApiExclude()
    @Controller('/')
    class TestCtrl {
      @Get('/')
      list() {}
    }

    const set = getMeta<Set<string>>(TestCtrl, API_EXCLUDE)
    expect(set?.has('*')).toBe(true)
  })

  it('@ApiExclude should mark method as excluded', () => {
    @Controller('/')
    class TestCtrl {
      @ApiExclude()
      @Get('/internal')
      internal() {}

      @Get('/public')
      public() {}
    }

    const set = getMeta<Set<string>>(TestCtrl, API_EXCLUDE)
    expect(set?.has('internal')).toBe(true)
    expect(set?.has('public')).toBe(false)
  })
})
