import { describe, it, expect } from 'bun:test'
import { toKebabCase, toPascalCase, lowerFirst } from '../src/utils/naming.js'

describe('toKebabCase', () => {
  it('converts PascalCase', () => {
    expect(toKebabCase('UserProfile')).toBe('user-profile')
  })

  it('converts camelCase', () => {
    expect(toKebabCase('userProfile')).toBe('user-profile')
  })

  it('keeps already kebab-case', () => {
    expect(toKebabCase('user-profile')).toBe('user-profile')
  })

  it('converts underscores', () => {
    expect(toKebabCase('user_profile')).toBe('user-profile')
  })

  it('handles single word', () => {
    expect(toKebabCase('user')).toBe('user')
  })

  it('handles uppercase single word', () => {
    expect(toKebabCase('User')).toBe('user')
  })

  it('handles consecutive uppercase', () => {
    expect(toKebabCase('HTTPServer')).toBe('httpserver')
  })
})

describe('toPascalCase', () => {
  it('converts kebab-case', () => {
    expect(toPascalCase('user-profile')).toBe('UserProfile')
  })

  it('converts snake_case', () => {
    expect(toPascalCase('user_profile')).toBe('UserProfile')
  })

  it('converts camelCase', () => {
    expect(toPascalCase('userProfile')).toBe('UserProfile')
  })

  it('keeps PascalCase input', () => {
    expect(toPascalCase('UserProfile')).toBe('UserProfile')
  })

  it('handles already-capitalized single word', () => {
    expect(toPascalCase('User')).toBe('User')
  })

  it('handles single word', () => {
    expect(toPascalCase('user')).toBe('User')
  })

  it('handles multiple segments', () => {
    expect(toPascalCase('my-cool-feature')).toBe('MyCoolFeature')
  })

  it('handles consecutive uppercase (no acronym boundary)', () => {
    // Consistent with toKebabCase('HTTPServer') === 'httpserver'
    expect(toPascalCase('HTTPServer')).toBe('Httpserver')
  })
})

describe('lowerFirst', () => {
  it('lowercases first character', () => {
    expect(lowerFirst('UserService')).toBe('userService')
  })

  it('keeps already lowercase', () => {
    expect(lowerFirst('userService')).toBe('userService')
  })

  it('handles single char', () => {
    expect(lowerFirst('U')).toBe('u')
  })
})
