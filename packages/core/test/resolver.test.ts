import { describe, expect, it } from 'bun:test'
import { Container } from '../src/di-container.js'
import { createToken } from '../src/di-token.js'
import { Resolver } from '../src/resolver.js'

describe('Resolver', () => {
  it('has() returns true for registered tokens', () => {
    const c = new Container()
    const GREETING = createToken<string>('greeting')
    c.register(GREETING, () => 'hello')
    const resolver = new Resolver(c)

    expect(resolver.has(GREETING)).toBe(true)
  })

  it('has() returns false for unregistered tokens', () => {
    const c = new Container()
    const resolver = new Resolver(c)

    expect(resolver.has(createToken('missing'))).toBe(false)
  })

  it('resolve() returns the singleton instance', () => {
    const c = new Container()
    const VAL = createToken<{ x: number }>('val')
    c.register(VAL, () => ({ x: 1 }))
    const resolver = new Resolver(c)

    expect(resolver.resolve(VAL)).toEqual({ x: 1 })
  })

  it('resolve() throws on unknown token', () => {
    const c = new Container()
    const resolver = new Resolver(c)

    expect(() => resolver.resolve(createToken('unknown'))).toThrow(/No provider found/)
  })

  it('resolveOptional() returns null on unknown token', () => {
    const c = new Container()
    const resolver = new Resolver(c)

    expect(resolver.resolveOptional(createToken('unknown'))).toBeNull()
  })

  it('resolveOptional() returns instance on registered token', () => {
    const c = new Container()
    const VAL = createToken<number>('val')
    c.register(VAL, () => 42)
    const resolver = new Resolver(c)

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
