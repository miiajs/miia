import { describe, expect, it } from 'bun:test'
import { Container } from '../src/di-container.js'
import { Resolver } from '../src/resolver.js'

describe('Resolver', () => {
  it('has() returns true for registered tokens', () => {
    const c = new Container()
    c.register('greeting', () => 'hello')
    const resolver = new Resolver(c)

    expect(resolver.has('greeting')).toBe(true)
  })

  it('has() returns false for unregistered tokens', () => {
    const c = new Container()
    const resolver = new Resolver(c)

    expect(resolver.has('missing')).toBe(false)
  })

  it('resolve() returns the singleton instance', () => {
    const c = new Container()
    c.register('val', () => ({ x: 1 }))
    const resolver = new Resolver(c)

    expect(resolver.resolve('val')).toEqual({ x: 1 })
  })

  it('resolve() throws on unknown token', () => {
    const c = new Container()
    const resolver = new Resolver(c)

    expect(() => resolver.resolve('unknown')).toThrow(/No provider found/)
  })

  it('resolveOptional() returns null on unknown token', () => {
    const c = new Container()
    const resolver = new Resolver(c)

    expect(resolver.resolveOptional('unknown')).toBeNull()
  })

  it('resolveOptional() returns instance on registered token', () => {
    const c = new Container()
    c.register('val', () => 42)
    const resolver = new Resolver(c)

    expect(resolver.resolveOptional<number>('val')).toBe(42)
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
