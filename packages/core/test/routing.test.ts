import { describe, expect, it } from 'bun:test'
import type { RequestContext } from '../src/index.js'
import { Router } from '../src/index.js'

const noop = (_ctx: RequestContext) => {}

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
