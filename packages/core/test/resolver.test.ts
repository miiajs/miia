import { describe, expect, it } from 'bun:test'
import { Container } from '../src/di-container.js'
import { createToken } from '../src/di-token.js'
import { Resolver } from '../src/resolver.js'
import type { ConfiguredModule } from '../src/index.js'
import { inject, Injectable, Miia, Module, provider } from '../src/index.js'

function thrownBy(fn: () => unknown): Error {
  try {
    fn()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected a throw')
}

async function initError(app: Miia): Promise<Error> {
  try {
    await app.init()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected init() to fail')
}

function report(block: string): string {
  return `[Miia] 1 module boundary violation:\n\n${block}\n\nDocs: /docs/core-concepts/modules#boundaries`
}

describe('Resolver', () => {
  it('has() returns true for registered tokens', () => {
    const c = new Container()
    const GREETING = createToken<string>('greeting')
    c.register(GREETING, () => 'hello')
    const resolver = new Resolver(c, 'root')

    expect(resolver.has(GREETING)).toBe(true)
  })

  it('has() returns false for unregistered tokens', () => {
    const c = new Container()
    const resolver = new Resolver(c, 'root')

    expect(resolver.has(createToken('missing'))).toBe(false)
  })

  it('resolve() returns the singleton instance', () => {
    const c = new Container()
    const VAL = createToken<{ x: number }>('val')
    c.register(VAL, () => ({ x: 1 }))
    const resolver = new Resolver(c, 'root')

    expect(resolver.resolve(VAL)).toEqual({ x: 1 })
  })

  it('resolve() throws on unknown token', () => {
    const c = new Container()
    const resolver = new Resolver(c, 'root')

    expect(() => resolver.resolve(createToken('unknown'))).toThrow(/No provider found/)
  })

  it('resolveOptional() returns null on unknown token', () => {
    const c = new Container()
    const resolver = new Resolver(c, 'root')

    expect(resolver.resolveOptional(createToken('unknown'))).toBeNull()
  })

  it('resolveOptional() returns instance on registered token', () => {
    const c = new Container()
    const VAL = createToken<number>('val')
    c.register(VAL, () => 42)
    const resolver = new Resolver(c, 'root')

    expect(resolver.resolveOptional(VAL)).toBe(42)
  })

  it('Miia auto-registers Resolver so it is injectable', async () => {
    const { Miia, inject, Injectable, Module, Resolver } = await import('@miiajs/core')
    const { TestApp } = await import('@miiajs/testing')

    @Injectable()
    class Probe {
      resolver = inject(Resolver)
    }

    @Module({ providers: [Probe] })
    class App {}

    const app = await TestApp.create(App).compile()
    const probe = app.resolve(Probe)
    expect(probe.resolver).toBeInstanceOf(Resolver)
    expect(probe.resolver.has(Probe)).toBe(true)
    await app.close()
    // silence unused
    void Miia
  })
})

describe('the Resolver of an entry several modules declare', () => {
  type Name = 'a' | 'b'

  const X = createToken<string>('X')

  @Module({ providers: [provider(X, () => 'x')], exports: [X] })
  class XModule {}

  const hiddenFromB =
    "Resolver of Dyn (name 'b') in HostB resolved X (XModule), which Dyn (name 'b') in HostB cannot see:\n" +
    '  - add XModule to HostB `imports`'

  /** A module class under two names: only the host of 'a' sees X. */
  function hosts(Dyn: { configure(name: Name): ConfiguredModule }) {
    @Module({ imports: [XModule, Dyn.configure('a')] })
    class HostA {}

    @Module({ imports: [Dyn.configure('b')] })
    class HostB {}

    @Module({ imports: [HostA, HostB] })
    class RootAB {}

    @Module({ imports: [HostB, HostA] })
    class RootBA {}

    return [RootAB, RootBA] as const
  }

  it('checks resolve() of a static provider of a module class under several names from every name', async () => {
    @Injectable()
    class Helper {
      x = inject(Resolver).resolve(X)
    }

    @Module({ providers: [Helper] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    const [RootAB, RootBA] = hosts(Dyn)
    const ab = await initError(new Miia({ logger: false }).register(RootAB))
    const ba = await initError(new Miia({ logger: false }).register(RootBA))
    expect(ab.message).toBe(report(hiddenFromB))
    expect(ba.message).toBe(ab.message)
  })

  it('has() is true only for a token every owning module sees, and resolve() is checked from each', async () => {
    @Injectable()
    class Helper {
      resolver = inject(Resolver)
    }

    @Module({ providers: [Helper] })
    class Dyn {
      static configure(name: Name): ConfiguredModule {
        return { module: Dyn, name }
      }
    }

    for (const Root of hosts(Dyn)) {
      const app = new Miia({ logger: false }).register(Root)
      await app.init()
      const { resolver } = app.get(Helper)
      expect(resolver.has(X)).toBe(false)
      expect(resolver.has(Helper)).toBe(true)
      expect(resolver.resolve(Resolver)).toBe(resolver)
      expect(thrownBy(() => resolver.resolve(X)).message).toBe(report(hiddenFromB))
      expect(thrownBy(() => resolver.resolveOptional(X)).message).toBe(report(hiddenFromB))
      expect(resolver.resolveOptional(createToken('Missing'))).toBeNull()
      await app.destroy()
    }
  })

  it('checks resolve() in the factory of a shared provider from every declaring module, in either order', async () => {
    const S = createToken<string>('S')
    const shared = () => provider(S, (resolve) => resolve(Resolver).resolve(X), { shared: 'k' })

    @Module({ imports: [XModule], providers: [shared()] })
    class ModuleA {}

    @Module({ providers: [shared()] })
    class ModuleB {}

    const ab = await initError(new Miia({ logger: false }).register(ModuleA, ModuleB))
    const ba = await initError(new Miia({ logger: false }).register(ModuleB, ModuleA))
    expect(ab.message).toBe(
      report(
        'Resolver of ModuleB resolved X (XModule), which ModuleB cannot see:\n  - add XModule to ModuleB `imports`',
      ),
    )
    expect(ba.message).toBe(ab.message)
  })
})
