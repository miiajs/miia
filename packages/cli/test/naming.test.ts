import { describe, expect, it } from 'bun:test'
import { CliError } from '../src/utils/errors.js'
import {
  splitWords,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
  validateArtifactName,
} from '../src/utils/naming.js'

describe('splitWords', () => {
  it('splits camel, Pascal, snake and kebab case and acronyms', () => {
    expect(splitWords('HTTPServer')).toEqual(['HTTP', 'Server'])
    expect(splitWords('userProfile')).toEqual(['user', 'Profile'])
    expect(splitWords('user_profile')).toEqual(['user', 'profile'])
    expect(splitWords('user-profile')).toEqual(['user', 'profile'])
    expect(splitWords('User2FA')).toEqual(['User2', 'FA'])
    expect(splitWords('HTTP2Server')).toEqual(['HTTP2', 'Server'])
  })
})

describe('case conversion', () => {
  const cases: Array<[string, string, string, string]> = [
    ['HTTPServer', 'HttpServer', 'httpServer', 'http-server'],
    ['userProfile', 'UserProfile', 'userProfile', 'user-profile'],
    ['user_profile', 'UserProfile', 'userProfile', 'user-profile'],
    ['user-profile', 'UserProfile', 'userProfile', 'user-profile'],
    ['UserProfile', 'UserProfile', 'userProfile', 'user-profile'],
    ['User2FA', 'User2Fa', 'user2Fa', 'user2-fa'],
    ['users', 'Users', 'users', 'users'],
  ]
  for (const [input, pascal, camel, kebab] of cases) {
    it(input, () => {
      expect(toPascalCase(input)).toBe(pascal)
      expect(toCamelCase(input)).toBe(camel)
      expect(toKebabCase(input)).toBe(kebab)
    })
  }
})

describe('toSnakeCase', () => {
  it('joins lower-case words with an underscore', () => {
    expect(toSnakeCase('user-profile')).toBe('user_profile')
    expect(toSnakeCase('userProfile')).toBe('user_profile')
    expect(toSnakeCase('user_profile')).toBe('user_profile')
    expect(toSnakeCase('HTTPServer')).toBe('http_server')
    expect(toSnakeCase('posts')).toBe('posts')
  })
})

describe('validateArtifactName', () => {
  it('splits a path from the name', () => {
    expect(validateArtifactName('users')).toEqual({ dir: '', name: 'users' })
    expect(validateArtifactName('admin/users')).toEqual({ dir: 'admin', name: 'users' })
    expect(validateArtifactName('a/b/user_profile')).toEqual({ dir: 'a/b', name: 'user_profile' })
  })

  it('rejects dots, empty segments, parent folders and leading digits', () => {
    for (const bad of ['user.profile', '../x', 'a//b', '', '/users', '2fa', 'my users', 'a\\b']) {
      expect(() => validateArtifactName(bad)).toThrow(CliError)
    }
    expect(() => validateArtifactName('user.profile')).toThrow('Invalid name "user.profile"')
  })
})
