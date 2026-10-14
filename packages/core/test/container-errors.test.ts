import { describe, expect, it } from 'bun:test'
import { Container, inject, Injectable, Miia, Module } from '../src/index.js'
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
      c.register('Entry', (resolve) => resolve('A'))
      c.register('A', (resolve) => resolve('B'))
      c.register('B', (resolve) => resolve('C'))
      c.register('C', (resolve) => resolve('A'))

      const message = errorOf(() => c.resolve('Entry'))
      expect(message.split('\n')[0]).toBe('[Miia] Circular dependency detected: A -> B -> C -> A')
    })

    it('shows both frames of an @Injectable({ token }) alias', () => {
      @Injectable({ token: 'svc' })
      class Svc {
        other = inject(Other)
      }

      @Injectable()
      class Other {
        svc = inject(Svc)
      }

      @Module({ providers: [Svc, Other] })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      expect(errorOf(() => app.get(Other))).toContain('Circular dependency detected: Other -> Svc -> svc -> Other')
    })
  })

  describe('construction stack', () => {
    it('is empty again after an error mid-construction', () => {
      const c = new Container()
      let fail = true
      c.register('flaky', () => {
        if (fail) throw new Error('boom')
        return 'ok'
      })
      class Outer {
        flaky = inject<string>('flaky')
      }
      c.registerClass(Outer)

      expect(() => c.resolve(Outer)).toThrow('boom')
      expect(errorOf(() => c.resolve('missing'))).toBe('[Miia] No provider found for token: missing')

      fail = false
      expect(c.resolve(Outer).flaky).toBe('ok')
    })

    it('is empty again after a cycle error', () => {
      const c = new Container()
      c.register('A', (resolve) => resolve('B'))
      c.register('B', (resolve) => resolve('A'))

      expect(() => c.resolve('A')).toThrow('[Miia] Circular dependency detected')
      expect(errorOf(() => c.resolve('missing'))).toBe('[Miia] No provider found for token: missing')
    })
  })

  describe('missing provider', () => {
    it('names the requester during construction', () => {
      const c = new Container()
      class Needy {
        dep = inject('missing')
      }
      c.registerClass(Needy)

      expect(errorOf(() => c.resolve(Needy))).toBe('[Miia] No provider found for token: missing, required by Needy')
    })

    it('names the requester of a factory provider', () => {
      const c = new Container()
      class Missing {}
      c.register('needy', (resolve) => resolve(Missing))

      expect(errorOf(() => c.resolve('needy'))).toBe('[Miia] No provider found for token: Missing, required by needy')
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
    it('prefers a string static __name', () => {
      class DbToken {
        static readonly __name = 'drizzleDb(default)'
      }
      expect(formatToken(DbToken)).toBe('drizzleDb(default)')
    })

    it('falls back to the class name', () => {
      class UsersService {}
      class OddName {
        static readonly __name = 42
      }
      expect(formatToken(UsersService)).toBe('UsersService')
      expect(formatToken(OddName)).toBe('OddName')
    })

    it('marks an anonymous class', () => {
      const anonymous = (() => class {})()
      expect(anonymous.name).toBe('')
      expect(formatToken(anonymous)).toBe('<anonymous>')
    })

    it('returns a string token as is', () => {
      expect(formatToken('config')).toBe('config')
    })
  })
})
