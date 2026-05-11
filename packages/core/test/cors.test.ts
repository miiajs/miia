import { describe, expect, it } from 'bun:test'
import { cors } from '../src/index.js'

describe('cors()', () => {
  it("throws when 'credentials: true' is combined with 'origin: \"*\"'", () => {
    expect(() => cors({ origin: '*', credentials: true })).toThrow(/credentials: true.*incompatible.*origin/)
  })

  it('allows \'origin: "*"\' without credentials (default)', () => {
    expect(() => cors({ origin: '*' })).not.toThrow()
  })

  it('allows explicit origin string with credentials', () => {
    expect(() => cors({ origin: 'https://example.com', credentials: true })).not.toThrow()
  })

  it('allows origin array with credentials', () => {
    expect(() => cors({ origin: ['https://a.com', 'https://b.com'], credentials: true })).not.toThrow()
  })

  it('allows origin function with credentials', () => {
    expect(() => cors({ origin: (o) => o === 'https://example.com', credentials: true })).not.toThrow()
  })

  it('defaults to safe config when no options passed', () => {
    expect(() => cors()).not.toThrow()
  })
})
