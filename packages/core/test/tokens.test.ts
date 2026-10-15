import { describe, expect, it } from 'bun:test'
import type { RequestContext } from '../src/index.js'
import {
  Controller,
  createToken,
  Get,
  inject,
  Injectable,
  injectOptional,
  Miia,
  Module,
  provider,
  Resolver,
} from '../src/index.js'
import { Container } from '../src/di-container.js'
import { formatToken } from '../src/di-token-format.js'

function errorOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected a throw')
}

interface Mailer {
  send(to: string): string
}

class SmtpMailer implements Mailer {
  send(to: string) {
    return `smtp:${to}`
  }
}

describe('typed tokens', () => {
  describe('createToken + provider()', () => {
    it('resolves a provider by the token object', () => {
      const MAILER = createToken<Mailer>('Mailer')

      @Module({ providers: [provider(MAILER, () => new SmtpMailer())] })
      class AppModule {}

      const app = new Miia({ logger: false }).register(AppModule)
      expect(app.get(MAILER).send('a')).toBe('smtp:a')
    })

    it('makes a new token on every call, even for the same name', () => {
      const first = createToken<string>('X')
      const second = createToken<string>('X')
      expect(first).not.toBe(second)

      const app = new Miia({ logger: false }).provide(provider(first, () => 'first'))
      expect(app.get(first)).toBe('first')
      expect(() => app.get(second)).toThrow('[Miia] No provider found for token: X')
    })

    it('freezes the token and leaves out hint when none is given', () => {
      const plain = createToken('plain')
      expect(Object.isFrozen(plain)).toBe(true)
      expect('hint' in plain).toBe(false)
      expect(plain.name).toBe('plain')

      const hinted = createToken('hinted', { hint: 'HintModule' })
      expect(Object.isFrozen(hinted)).toBe(true)
      expect(hinted.hint).toBe('HintModule')
    })

    it('passes the scope through', () => {
      let seq = 0
      const COUNTER = createToken<{ id: number }>('Counter')
      const app = new Miia({ logger: false }).provide(provider(COUNTER, () => ({ id: ++seq }), { scope: 'transient' }))

      expect(app.get(COUNTER).id).not.toBe(app.get(COUNTER).id)
    })

    it('hands the factory a resolver', () => {
      const PREFIX = createToken<string>('Prefix')
      const GREETING = createToken<string>('Greeting')
      const app = new Miia({ logger: false }).provide(
        provider(PREFIX, () => 'hello'),
        provider(GREETING, (resolve) => `${resolve(PREFIX)} world`),
      )

      expect(app.get(GREETING)).toBe('hello world')
    })
  })

  it('injectOptional() returns null for an unregistered token', () => {
    const MAILER = createToken<Mailer>('Mailer')

    @Injectable()
    class Notifications {
      mailer = injectOptional(MAILER)
    }

    const app = new Miia({ logger: false }).provide(Notifications)
    expect(app.get(Notifications).mailer).toBeNull()
  })

  it('accepts an abstract class as a token', () => {
    abstract class Storage {
      abstract read(key: string): string
    }
    class MemoryStorage extends Storage {
      read(key: string) {
        return `memory:${key}`
      }
    }

    @Injectable()
    class Reader {
      storage = inject(Storage)
    }

    const app = new Miia({ logger: false }).provide(
      provider(Storage, () => new MemoryStorage()),
      Reader,
    )
    expect(app.get(Reader).storage).toBeInstanceOf(MemoryStorage)
    expect(app.get(Reader).storage.read('k')).toBe('memory:k')
  })

  describe('resolution with a token', () => {
    const MAILER = createToken<Mailer>('Mailer')

    @Injectable()
    class Notifications {
      mailer = inject(MAILER)
    }

    @Controller('/mail')
    class MailController {
      @Get('/')
      send(ctx: RequestContext) {
        return { sent: ctx.resolve(MAILER).send('ctx') }
      }
    }

    @Module({ controllers: [MailController], providers: [provider(MAILER, () => new SmtpMailer()), Notifications] })
    class AppModule {}

    it('inject()', () => {
      const app = new Miia({ logger: false }).register(AppModule)
      expect(app.get(Notifications).mailer).toBeInstanceOf(SmtpMailer)
    })

    it('app.get()', () => {
      const app = new Miia({ logger: false }).register(AppModule)
      expect(app.get(MAILER)).toBe(app.get(Notifications).mailer)
    })

    it('ctx.resolve()', async () => {
      const app = new Miia({ logger: false }).register(AppModule)
      const res = await app.fetch(new Request('http://localhost/mail/'))
      expect(await res.json()).toEqual({ sent: 'smtp:ctx' })
    })

    it('Resolver.resolve()', () => {
      const app = new Miia({ logger: false }).register(AppModule)
      const resolver = app.get(Resolver)
      expect(resolver.has(MAILER)).toBe(true)
      expect(resolver.resolve(MAILER)).toBe(app.get(MAILER))
      expect(resolver.resolveOptional(createToken('Other'))).toBeNull()
    })
  })

  describe('"No provider" hint', () => {
    it('names the source given to createToken()', () => {
      const MAILER = createToken<Mailer>('Mailer', { hint: 'MailModule.configure()' })
      class Needy {
        mailer = inject(MAILER)
      }
      const c = new Container()
      c.registerClass(Needy)

      expect(errorOf(() => c.resolve(Needy))).toBe(
        '[Miia] No provider found for token: Mailer, required by Needy\n' +
          '  - Mailer is provided by MailModule.configure(); import that module where Mailer is used',
      )
    })

    it('names the source given to @Injectable({ hint })', () => {
      @Injectable({ hint: 'UsersModule' })
      class UsersService {}

      const c = new Container()
      expect(errorOf(() => c.resolve(UsersService))).toBe(
        '[Miia] No provider found for token: UsersService\n' +
          '  - UsersService is provided by UsersModule; import that module where UsersService is used',
      )
    })

    it('adds no line without a hint', () => {
      const c = new Container()
      @Injectable()
      class UsersService {}

      expect(errorOf(() => c.resolve(createToken('Mailer')))).toBe('[Miia] No provider found for token: Mailer')
      expect(errorOf(() => c.resolve(UsersService))).toBe('[Miia] No provider found for token: UsersService')
    })
  })

  describe('two copies of a package', () => {
    const copyLine =
      '  - another token named db with the same hint is registered: if db is defined twice on purpose ' +
      '(e.g. one model per connection), register this one too; otherwise two copies of the package ' +
      'that defines it are probably installed - deduplicate the dependency'

    it('flags another token with the same name and hint', () => {
      const registered = createToken('db', { hint: 'DbModule.configure()' })
      const other = createToken('db', { hint: 'DbModule.configure()' })
      const c = new Container()
      c.register(registered, () => ({}))

      expect(errorOf(() => c.resolve(other))).toBe(
        '[Miia] No provider found for token: db\n' +
          '  - db is provided by DbModule.configure(); import that module where db is used\n' +
          copyLine,
      )
    })

    it('flags another class with the same name and @Injectable hint', () => {
      const copyA = (() => {
        @Injectable({ hint: 'DbModule' })
        class DbService {}
        return DbService
      })()
      const copyB = (() => {
        @Injectable({ hint: 'DbModule' })
        class DbService {}
        return DbService
      })()
      const c = new Container()
      c.registerClass(copyA)

      expect(errorOf(() => c.resolve(copyB))).toContain(
        '  - another token named DbService with the same hint is registered',
      )
    })

    it('stays silent for unrelated classes with the same name and no hint', () => {
      const first = (() => {
        class UsersService {}
        return UsersService
      })()
      const second = (() => {
        class UsersService {}
        return UsersService
      })()
      const c = new Container()
      c.registerClass(first)

      expect(errorOf(() => c.resolve(second))).toBe('[Miia] No provider found for token: UsersService')
    })

    it('stays silent for tokens with the same name and no hint', () => {
      const c = new Container()
      c.register(createToken('db'), () => ({}))

      expect(errorOf(() => c.resolve(createToken('db')))).toBe('[Miia] No provider found for token: db')
    })
  })

  it('formatToken() prints the name of a token object', () => {
    expect(formatToken(createToken('Mailer'))).toBe('Mailer')
    expect(formatToken(createToken(''))).toBe('<anonymous>')
  })

  it('TestApp.override() replaces a token with a mock', async () => {
    const core = await import('@miiajs/core')
    const { TestApp } = await import('@miiajs/testing')

    const MAILER = core.createToken<Mailer>('Mailer')

    @core.Injectable()
    class Notifications {
      mailer = core.inject(MAILER)
    }

    @core.Module({ providers: [core.provider(MAILER, () => new SmtpMailer()), Notifications] })
    class AppModule {}

    const app = await TestApp.create(AppModule)
      .override(MAILER, { send: (to: string) => `mock:${to}` })
      .compile()
    expect(app.resolve(Notifications).mailer.send('a')).toBe('mock:a')
    expect(app.resolve(MAILER).send('b')).toBe('mock:b')
    await app.close()
  })
})
