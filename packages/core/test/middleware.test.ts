import { describe, expect, it } from 'bun:test'
import type { Middleware, RequestContext } from '../src/index.js'
import { compose, CookieJar, ResponseBuilder } from '../src/index.js'

function createMockContext(overrides: Partial<RequestContext> = {}): RequestContext {
  const req = new Request('http://localhost/')
  const res = new ResponseBuilder()
  return {
    req,
    res,
    params: {},
    query: {},
    rawQuery: new URLSearchParams(),
    conn: {},
    ip: undefined,
    cookies: new CookieJar(req, res),
    json: async <T = any>() => null as T,
    text: async () => '',
    _setBody: () => {},
    resolve: () => {
      throw new Error('not in test')
    },
    ...overrides,
  }
}

describe('compose', () => {
  it('should execute middlewares in order (onion model)', async () => {
    const order: string[] = []

    const mw1: Middleware = async (_ctx, next) => {
      order.push('mw1-before')
      await next()
      order.push('mw1-after')
    }
    const mw2: Middleware = async (_ctx, next) => {
      order.push('mw2-before')
      await next()
      order.push('mw2-after')
    }

    const composed = compose([mw1, mw2])
    const ctx = createMockContext()
    await composed(ctx, async () => {
      order.push('handler')
    })

    expect(order).toEqual(['mw1-before', 'mw2-before', 'handler', 'mw2-after', 'mw1-after'])
  })

  it('should work with no middlewares', async () => {
    const composed = compose([])
    const ctx = createMockContext()
    let called = false
    await composed(ctx, async () => {
      called = true
    })
    expect(called).toBe(true)
  })

  it('should propagate errors', async () => {
    const errorMw: Middleware = async (_ctx, _next) => {
      throw new Error('boom')
    }

    const composed = compose([errorMw])
    const ctx = createMockContext()
    await expect(composed(ctx, async () => {})).rejects.toThrow('boom')
  })

  it('should throw if next() called multiple times', async () => {
    const badMw: Middleware = async (_ctx, next) => {
      await next()
      await next()
    }

    const composed = compose([badMw])
    const ctx = createMockContext()
    await expect(composed(ctx, async () => {})).rejects.toThrow('next() called multiple times')
  })

  it('a synchronous throw rejects the returned promise', async () => {
    const syncThrow: Middleware = () => {
      throw new Error('sync')
    }

    let result: Promise<void> | undefined
    expect(() => {
      result = compose([syncThrow])(createMockContext(), async () => {})
    }).not.toThrow()
    await expect(result!).rejects.toThrow('sync')
  })

  it('a synchronous throw from next() rejects too', async () => {
    const callsNext: Middleware = (_ctx, next) => next()
    const composed = compose([callsNext])
    await expect(
      composed(createMockContext(), () => {
        throw new Error('from next')
      }),
    ).rejects.toThrow('from next')
  })

  it('a second next() rejects inside the middleware, and runs nothing again', async () => {
    let calls = 0
    let caught: unknown
    const twice: Middleware = async (_ctx, next) => {
      await next()
      try {
        await next()
      } catch (err) {
        caught = err
      }
    }

    await compose([twice])(createMockContext(), async () => {
      calls++
    })
    expect(calls).toBe(1)
    expect((caught as Error).message).toBe('next() called multiple times')
  })

  it('a composed chain nests inside another', async () => {
    const order: string[] = []
    const mw =
      (name: string): Middleware =>
      async (_ctx, next) => {
        order.push(`${name}>`)
        await next()
        order.push(`<${name}`)
      }

    await compose([mw('a'), compose([mw('b'), compose([mw('c')])])])(createMockContext(), async () => {
      order.push('handler')
    })
    expect(order).toEqual(['a>', 'b>', 'c>', 'handler', '<c', '<b', '<a'])
  })

  it('should short-circuit if next is not called', async () => {
    const order: string[] = []

    const blocking: Middleware = async (_ctx, _next) => {
      order.push('blocked')
      // Intentionally not calling next()
    }
    const after: Middleware = async (_ctx, next) => {
      order.push('should-not-run')
      await next()
    }

    const composed = compose([blocking, after])
    const ctx = createMockContext()
    await composed(ctx, async () => {
      order.push('handler')
    })

    expect(order).toEqual(['blocked'])
  })

  it('should allow middleware to modify context', async () => {
    const setParams: Middleware = async (ctx, next) => {
      ctx.params = { id: '1' }
      await next()
    }

    const composed = compose([setParams])
    const ctx = createMockContext()
    await composed(ctx, async () => {})
    expect(ctx.params).toEqual({ id: '1' })
  })
})
