import { describe, expect, it } from 'bun:test'
import { timingSafeEqual } from '../src/timing-safe.js'

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true)
  })

  it('returns false for different strings of the same length', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false)
  })

  it('returns false for strings of different length', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeEqual('abcd', 'abc')).toBe(false)
  })

  it('returns true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true)
  })

  it('handles multibyte UTF-8 correctly', () => {
    expect(timingSafeEqual('café', 'café')).toBe(true)
    expect(timingSafeEqual('café', 'cafe')).toBe(false)
  })
})
