import { beforeEach, describe, expect, it } from 'bun:test'
import { Container, inject, Injectable } from '../src/index.js'

describe('Container', () => {
  let c: Container

  beforeEach(() => {
    c = new Container()
  })

  describe('register & resolve', () => {
    it('should register and resolve by string token', () => {
      c.register('greeting', () => 'hello')
      expect(c.resolve<string>('greeting')).toBe('hello')
    })

    it('should register and resolve by class constructor', () => {
      class MyService {
        value = 42
      }

      c.registerClass(MyService)
      const instance = c.resolve(MyService)
      expect(instance).toBeInstanceOf(MyService)
      expect(instance.value).toBe(42)
    })

    it('should throw when resolving unregistered token', () => {
      expect(() => c.resolve('unknown')).toThrow('[Miia] No provider found for token')
    })
  })

  describe('resolveOptional', () => {
    it('should return null for unregistered token', () => {
      expect(c.resolveOptional('unknown')).toBeNull()
    })

    it('should return instance for registered token', () => {
      c.register('val', () => 123)
      expect(c.resolveOptional<number>('val')).toBe(123)
    })
  })

  describe('has', () => {
    it('should return true for registered token', () => {
      c.register('key', () => 'value')
      expect(c.has('key')).toBe(true)
    })

    it('should return false for unregistered token', () => {
      expect(c.has('missing')).toBe(false)
    })
  })

  describe('scopes', () => {
    it('singleton: should return same instance', () => {
      let count = 0
      c.register('counter', () => ++count, 'singleton')
      expect(c.resolve<number>('counter')).toBe(1)
      expect(c.resolve<number>('counter')).toBe(1)
    })

    it('transient: should return new instance each time', () => {
      let count = 0
      c.register('counter', () => ++count, 'transient')
      expect(c.resolve<number>('counter')).toBe(1)
      expect(c.resolve<number>('counter')).toBe(2)
      expect(c.resolve<number>('counter')).toBe(3)
    })

    it('request: should cache per request scope', () => {
      let count = 0
      c.register('counter', () => ++count, 'request')
      expect(c.resolve<number>('counter')).toBe(1)
      expect(c.resolve<number>('counter')).toBe(1)

      c.clearRequestScope()
      expect(c.resolve<number>('counter')).toBe(2)
      expect(c.resolve<number>('counter')).toBe(2)
    })
  })

  describe('factory with resolve', () => {
    it('should pass resolve to factory when it accepts an argument', () => {
      c.register('dep', () => 'dependency')
      c.register('service', (resolve) => {
        const dep = resolve<string>('dep')
        return `service-${dep}`
      })
      expect(c.resolve<string>('service')).toBe('service-dependency')
    })
  })

  describe('lifecycle', () => {
    it('initAll should call onInit on singletons', async () => {
      const calls: string[] = []
      c.register('a', () => ({
        onInit: async () => {
          calls.push('a-init')
        },
      }))
      c.register('b', () => ({
        onInit: async () => {
          calls.push('b-init')
        },
      }))

      await c.initAll()
      expect(calls).toContain('a-init')
      expect(calls).toContain('b-init')
    })

    it('destroyAll should call onDestroy on singletons', async () => {
      const calls: string[] = []
      c.register('a', () => ({
        onDestroy: async () => {
          calls.push('a-destroy')
        },
      }))

      // Must resolve first to create the instance
      c.resolve('a')
      await c.destroyAll()
      expect(calls).toEqual(['a-destroy'])
    })

    it('initAll should not call onInit on transient providers', async () => {
      const calls: string[] = []
      c.register(
        't',
        () => ({
          onInit: async () => {
            calls.push('transient-init')
          },
        }),
        'transient',
      )

      await c.initAll()
      expect(calls).toEqual([])
    })
  })

  describe('circular dependencies', () => {
    it('should throw on circular dependency', () => {
      c.register('A', (resolve) => resolve('B'))
      c.register('B', (resolve) => resolve('A'))
      expect(() => c.resolve('A')).toThrow('[Miia] Circular dependency detected')
    })
  })
})
