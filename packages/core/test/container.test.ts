import { beforeEach, describe, expect, it } from 'bun:test'
import { Container } from '../src/di-container.js'
import { createToken } from '../src/index.js'

describe('Container', () => {
  let c: Container

  beforeEach(() => {
    c = new Container()
  })

  describe('register & resolve', () => {
    it('should register and resolve by token object', () => {
      const GREETING = createToken<string>('greeting')
      c.register(GREETING, () => 'hello')
      expect(c.resolve(GREETING)).toBe('hello')
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
      expect(() => c.resolve(createToken('unknown'))).toThrow('[Miia] No provider found for token')
    })
  })

  describe('resolveOptional', () => {
    it('should return null for unregistered token', () => {
      expect(c.resolveOptional(createToken('unknown'))).toBeNull()
    })

    it('should return instance for registered token', () => {
      const VAL = createToken<number>('val')
      c.register(VAL, () => 123)
      expect(c.resolveOptional(VAL)).toBe(123)
    })
  })

  describe('has', () => {
    it('should return true for registered token', () => {
      const KEY = createToken<string>('key')
      c.register(KEY, () => 'value')
      expect(c.has(KEY)).toBe(true)
    })

    it('should return false for unregistered token', () => {
      expect(c.has(createToken('missing'))).toBe(false)
    })
  })

  describe('scopes', () => {
    const COUNTER = createToken<number>('counter')

    it('singleton: should return same instance', () => {
      let count = 0
      c.register(COUNTER, () => ++count, 'singleton')
      expect(c.resolve(COUNTER)).toBe(1)
      expect(c.resolve(COUNTER)).toBe(1)
    })

    it('transient: should return new instance each time', () => {
      let count = 0
      c.register(COUNTER, () => ++count, 'transient')
      expect(c.resolve(COUNTER)).toBe(1)
      expect(c.resolve(COUNTER)).toBe(2)
      expect(c.resolve(COUNTER)).toBe(3)
    })

    it('request: should cache per request scope', () => {
      let count = 0
      c.register(COUNTER, () => ++count, 'request')
      const first = { _scope: null }
      expect(c.resolveInRequest(COUNTER, first)).toBe(1)
      expect(c.resolveInRequest(COUNTER, first)).toBe(1)

      const second = { _scope: null }
      expect(c.resolveInRequest(COUNTER, second)).toBe(2)
      expect(c.resolveInRequest(COUNTER, second)).toBe(2)
      expect(c.resolveInRequest(COUNTER, first)).toBe(1)
    })

    it('request: should throw when resolved outside a request', () => {
      c.register(COUNTER, () => 1, 'request')
      expect(() => c.resolve(COUNTER)).toThrow(/can only be resolved inside a request/)
    })
  })

  describe('factory with resolve', () => {
    it('should pass resolve to factory when it accepts an argument', () => {
      const DEP = createToken<string>('dep')
      const SERVICE = createToken<string>('service')
      c.register(DEP, () => 'dependency')
      c.register(SERVICE, (resolve) => {
        const dep = resolve(DEP)
        return `service-${dep}`
      })
      expect(c.resolve(SERVICE)).toBe('service-dependency')
    })
  })

  describe('lifecycle', () => {
    it('initAll should call onInit on singletons', async () => {
      const calls: string[] = []
      c.register(createToken('a'), () => ({
        onInit: async () => {
          calls.push('a-init')
        },
      }))
      c.register(createToken('b'), () => ({
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
      const A = createToken('a')
      c.register(A, () => ({
        onDestroy: async () => {
          calls.push('a-destroy')
        },
      }))

      // Must resolve first to create the instance
      c.resolve(A)
      await c.destroyAll()
      expect(calls).toEqual(['a-destroy'])
    })

    it('initAll should not call onInit on transient providers', async () => {
      const calls: string[] = []
      c.register(
        createToken('t'),
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
      const A = createToken('A')
      const B = createToken('B')
      c.register(A, (resolve) => resolve(B))
      c.register(B, (resolve) => resolve(A))
      expect(() => c.resolve(A)).toThrow('[Miia] Circular dependency detected')
    })
  })
})
