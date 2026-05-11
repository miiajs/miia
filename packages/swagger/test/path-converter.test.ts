import { describe, expect, it } from 'bun:test'
import { extractPathParams, toOpenApiPath } from '../src/index.js'

describe('toOpenApiPath', () => {
  it('should convert :param to {param}', () => {
    expect(toOpenApiPath('users/:id')).toBe('/users/{id}')
  })

  it('should handle multiple params', () => {
    expect(toOpenApiPath('users/:userId/posts/:postId')).toBe('/users/{userId}/posts/{postId}')
  })

  it('should handle path with leading slash', () => {
    expect(toOpenApiPath('/users/:id')).toBe('/users/{id}')
  })

  it('should handle root path', () => {
    expect(toOpenApiPath('/')).toBe('/')
  })

  it('should handle empty path', () => {
    expect(toOpenApiPath('')).toBe('/')
  })

  it('should handle path without params', () => {
    expect(toOpenApiPath('users/all')).toBe('/users/all')
  })
})

describe('extractPathParams', () => {
  it('should extract param names', () => {
    expect(extractPathParams('users/:id')).toEqual(['id'])
  })

  it('should extract multiple params', () => {
    expect(extractPathParams('users/:userId/posts/:postId')).toEqual(['userId', 'postId'])
  })

  it('should return empty array for no params', () => {
    expect(extractPathParams('users/all')).toEqual([])
  })
})
