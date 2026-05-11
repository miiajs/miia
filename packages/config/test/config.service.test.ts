import { describe, expect, it } from 'bun:test'
import { Container, runInContainerContext } from '@miiajs/core'
import { ConfigService } from '../src/config.service.js'

interface AppConfig {
  PORT: string
  HOST: string
  DEBUG?: string
}

function createService<T extends Record<string, any>>(values?: T): ConfigService<T> {
  const container = new Container()
  if (values !== undefined) {
    container.register('CONFIG_VALUES', () => values, 'singleton')
  }
  return runInContainerContext(container, () => new ConfigService<T>())
}

describe('ConfigService', () => {
  describe('get()', () => {
    it('returns the value for an existing key', () => {
      const service = createService<AppConfig>({ PORT: '3000', HOST: 'localhost' })
      expect(service.get('PORT')).toBe('3000')
      expect(service.get('HOST')).toBe('localhost')
    })

    it('returns undefined for a missing key', () => {
      const service = createService<AppConfig>({ PORT: '3000', HOST: 'localhost' })
      expect(service.get('DEBUG')).toBeUndefined()
    })

    it('preserves the original value type', () => {
      const service = createService({
        PORT: 3000,
        FLAG: true,
        NESTED: { foo: 'bar' },
      })
      expect(service.get('PORT')).toBe(3000)
      expect(service.get('FLAG')).toBe(true)
      expect(service.get('NESTED')).toEqual({ foo: 'bar' })
    })
  })

  describe('getOrThrow()', () => {
    it('returns the value for an existing key', () => {
      const service = createService<AppConfig>({ PORT: '3000', HOST: 'localhost' })
      expect(service.getOrThrow('PORT')).toBe('3000')
    })

    it('throws when the key is missing', () => {
      const service = createService<AppConfig>({ PORT: '3000', HOST: 'localhost' })
      expect(() => service.getOrThrow('DEBUG')).toThrow('[Miia] Config key "DEBUG" not found')
    })

    it('throws when the value is explicitly undefined', () => {
      const service = createService({ KEY: undefined })
      expect(() => service.getOrThrow('KEY')).toThrow('[Miia] Config key "KEY" not found')
    })

    it('returns falsy values that are not undefined', () => {
      const service = createService({ EMPTY: '', ZERO: 0, FALSE: false, NULL: null })
      expect(service.getOrThrow('EMPTY')).toBe('')
      expect(service.getOrThrow('ZERO')).toBe(0)
      expect(service.getOrThrow('FALSE')).toBe(false)
      expect(service.getOrThrow('NULL')).toBe(null)
    })
  })

  describe('without CONFIG_VALUES registered', () => {
    it('falls back to an empty object', () => {
      const service = createService()
      expect(service.get('ANYTHING' as any)).toBeUndefined()
      expect(() => service.getOrThrow('ANYTHING' as any)).toThrow('[Miia] Config key "ANYTHING" not found')
    })
  })
})
