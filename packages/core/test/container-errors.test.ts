import { describe, expect, it } from 'bun:test'
import { Container } from '../src/di-container.js'
import { createToken, inject, Miia, Module } from '../src/index.js'
import { formatToken } from '../src/di-token-format.js'

function errorOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected a throw')
}

describe('DI errors', () => {
  describe('circular dependency', () => {
    it('names the classes in the chain instead of printing their source', () => {
      const c = new Container()
      class A {
        b = inject(B)
      }
      class B {
        a = inject(A)
      }
      c.registerClass(A)
      c.registerClass(B)

      const message = errorOf(() => c.resolve(A))
      expect(message).toContain('[Miia] Circular dependency detected: A -> B -> A')
      expect(message).toContain('  - move the shared logic into a separate provider both can inject')
      expect(message).toContain('  - or decouple with events (@miiajs/messaging)')
      expect(message).toContain(
        '  - or, if the cycle is intended, resolve one side lazily through Resolver in a getter',
      )
      expect(message).not.toContain('class ')
    })

    it('starts the chain at the first occurrence of the token', () => {
      const c = new Container()
      const Entry = createToken('Entry')
      const A = createToken('A')
      const B = createToken('B')
      const C = createToken('C')
      c.register(Entry, (resolve) => resolve(A))
      c.register(A, (resolve) => resolve(B))
      c.register(B, (resolve) => resolve(C))
      c.register(C, (resolve) => resolve(A))

      const message = errorOf(() => c.resolve(Entry))
      expect(message.split('\n')[0]).toBe('[Miia] Circular dependency detected: A -> B -> C -> A')
    })
  })

  describe('construction stack', () => {
    it('is empty again after an error mid-construction', () => {
      const c = new Container()
      let fail = true
      const FLAKY = createToken<string>('flaky')
      c.register(FLAKY, () => {
        if (fail) throw new Error('boom')
        return 'ok'
      })
      class Outer {
        flaky = inject(FLAKY)
      }
      c.registerClass(Outer)

      expect(() => c.resolve(Outer)).toThrow('boom')
      expect(errorOf(() => c.resolve(createToken('missing')))).toBe('[Miia] No provider found for token: missing')

      fail = false
      expect(c.resolve(Outer).flaky).toBe('ok')
    })

    it('is empty again after a cycle error', () => {
      const c = new Container()
      const A = createToken('A')
      const B = createToken('B')
      c.register(A, (resolve) => resolve(B))
      c.register(B, (resolve) => resolve(A))

      expect(() => c.resolve(A)).toThrow('[Miia] Circular dependency detected')
      expect(errorOf(() => c.resolve(createToken('missing')))).toBe('[Miia] No provider found for token: missing')
    })
  })

  describe('missing provider', () => {
    it('names the requester during construction', () => {
      const c = new Container()
      const MISSING = createToken('missing')
      class Needy {
        dep = inject(MISSING)
      }
      c.registerClass(Needy)

      expect(errorOf(() => c.resolve(Needy))).toBe('[Miia] No provider found for token: missing, required by Needy')
    })

    it('names the requester of a factory provider', () => {
      const c = new Container()
      class Missing {}
      const needy = createToken('needy')
      c.register(needy, (resolve) => resolve(Missing))

      expect(errorOf(() => c.resolve(needy))).toBe('[Miia] No provider found for token: Missing, required by needy')
    })

    it('omits the requester at the top level', () => {
      const c = new Container()
      class Missing {}

      expect(errorOf(() => c.resolve(Missing))).toBe('[Miia] No provider found for token: Missing')
    })
  })

  describe('duplicate provider', () => {
    it('names a class token of a factory provider instead of printing its source', () => {
      class Config {}

      @Module({ providers: [{ token: Config, factory: () => new Config() }] })
      class ModuleA {}

      @Module({ providers: [{ token: Config, factory: () => new Config() }] })
      class ModuleB {}

      const app = new Miia({ logger: false }).register(ModuleA, ModuleB)
      const message = errorOf(() => app.get(Config))
      expect(message).toContain('[Miia] Duplicate provider: Config is already registered')
      expect(message).not.toContain('class ')
    })
  })

  describe('formatToken', () => {
    it('uses the class name', () => {
      class UsersService {}
      expect(formatToken(UsersService)).toBe('UsersService')
    })

    it('marks an anonymous class', () => {
      const anonymous = (() => class {})()
      expect(anonymous.name).toBe('')
      expect(formatToken(anonymous)).toBe('<anonymous>')
    })

    it('uses the name of a token object', () => {
      expect(formatToken(createToken('config'))).toBe('config')
    })
  })
})
