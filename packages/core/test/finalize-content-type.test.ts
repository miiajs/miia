import { describe, expect, it } from 'bun:test'
import { Miia, type Middleware, type RequestContext } from '../src/index.js'

type Handler = (ctx: RequestContext) => unknown

const passThrough: Middleware = async (_ctx, next) => {
  await next()
}

// Each one reaches respond() in app.ts its own way: straight from the handler, after a route middleware,
// and after a global one
const setups: Record<string, (app: Miia, handler: Handler) => void> = {
  'no middleware': (app, handler) => app.addRoute('GET', '/', handler),
  'route middleware': (app, handler) => app.addRoute('GET', '/', handler, { middlewares: [passThrough] }),
  'global middleware': (app, handler) => app.use(passThrough).addRoute('GET', '/', handler),
}

async function fetchWith(setup: (app: Miia, handler: Handler) => void, handler: Handler, method = 'GET') {
  const app = new Miia({ logger: false })
  setup(app, handler)
  const res = await app.fetch(new Request('http://localhost/', { method }))
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() }
}

describe('a returned value next to what the handler set on ctx.res', () => {
  for (const [name, setup] of Object.entries(setups)) {
    describe(name, () => {
      it('sends a returned object as JSON under the Content-Type the handler set', async () => {
        const res = await fetchWith(setup, (ctx) => {
          ctx.res.header('content-type', 'application/vnd.api+json')
          return { custom: true }
        })
        expect(res).toEqual({ status: 200, type: 'application/vnd.api+json', body: '{"custom":true}' })
      })

      it('does the same for an async handler, keeping the status it set', async () => {
        const res = await fetchWith(setup, async (ctx) => {
          ctx.res.status(201).header('Content-Type', 'application/problem+json')
          return { custom: true }
        })
        expect(res).toEqual({ status: 201, type: 'application/problem+json', body: '{"custom":true}' })
      })

      it('sends a returned string JSON-encoded too, under the Content-Type the handler set', async () => {
        const res = await fetchWith(setup, (ctx) => {
          ctx.res.header('content-type', 'text/csv')
          return 'a,b'
        })
        expect(res).toEqual({ status: 200, type: 'text/csv', body: '"a,b"' })
      })

      it('sends application/json when the handler set no Content-Type', async () => {
        const res = await fetchWith(setup, (ctx) => {
          ctx.res.header('x-custom', '1')
          return { a: 1 }
        })
        expect(res).toEqual({ status: 200, type: 'application/json', body: '{"a":1}' })
      })

      it('keeps a body the handler set with ctx.res.text() over the returned value', async () => {
        const res = await fetchWith(setup, (ctx) => {
          ctx.res.text('x')
          return { a: 1 }
        })
        expect(res.body).toBe('x')
        expect(res.type).toStartWith('text/plain')
      })

      it('keeps a body the handler set with ctx.res.json() over the returned value', async () => {
        const res = await fetchWith(setup, (ctx) => {
          ctx.res.json({ set: true })
          return { returned: true }
        })
        expect(res).toEqual({ status: 200, type: 'application/json', body: '{"set":true}' })
      })

      it('keeps a stream the handler set, adding no Content-Type for the returned value - GET and HEAD', async () => {
        for (const method of ['GET', 'HEAD']) {
          const res = await fetchWith(
            setup,
            (ctx) => {
              ctx.res.stream(new Blob(['abc']).stream())
              return { a: 1 }
            },
            method,
          )
          expect(res).toEqual({ status: 200, type: null, body: method === 'GET' ? 'abc' : '' })
        }
      })

      it('HEAD: never serializes the returned value', async () => {
        let serialized = 0
        const value = () => ({
          toJSON() {
            serialized++
            return { a: 1 }
          },
        })
        const plain = await fetchWith(setup, value, 'HEAD')
        const touched = await fetchWith(
          setup,
          (ctx) => {
            ctx.res.header('x-custom', '1')
            return value()
          },
          'HEAD',
        )
        expect(plain).toEqual({ status: 200, type: 'application/json', body: '' })
        expect(touched).toEqual({ status: 200, type: 'application/json', body: '' })
        expect(serialized).toBe(0)
      })

      it('HEAD: the Content-Type the handler set, no body', async () => {
        const res = await fetchWith(
          setup,
          (ctx) => {
            ctx.res.header('content-type', 'application/vnd.api+json')
            return { custom: true }
          },
          'HEAD',
        )
        expect(res).toEqual({ status: 200, type: 'application/vnd.api+json', body: '' })
      })

      it('HEAD: application/json when the handler set no Content-Type, no body', async () => {
        const res = await fetchWith(
          setup,
          (ctx) => {
            ctx.res.header('x-custom', '1')
            return { a: 1 }
          },
          'HEAD',
        )
        expect(res).toEqual({ status: 200, type: 'application/json', body: '' })
      })
    })
  }
})

describe('a returned ctx.res', () => {
  for (const [name, setup] of Object.entries(setups)) {
    describe(name, () => {
      it('return ctx.res.redirect(): the redirect, no JSON body - GET and HEAD', async () => {
        for (const method of ['GET', 'HEAD']) {
          const app = new Miia({ logger: false })
          setup(app, (ctx) => ctx.res.redirect('/login'))
          const res = await app.fetch(new Request('http://localhost/', { method }))
          expect(res.status).toBe(302)
          expect(res.headers.get('location')).toBe('/login')
          expect(res.headers.get('content-type')).toBeNull()
          expect(await res.text()).toBe('')
        }
      })

      it('return ctx.res.status(201).json(x): the status and x', async () => {
        const res = await fetchWith(setup, async (ctx) => ctx.res.status(201).json({ id: 1 }))
        expect(res).toEqual({ status: 201, type: 'application/json', body: '{"id":1}' })
        const head = await fetchWith(setup, (ctx) => ctx.res.status(201).json({ id: 1 }), 'HEAD')
        expect(head).toEqual({ status: 201, type: 'application/json', body: '' })
      })

      it('return ctx.res untouched: the same as returning nothing', async () => {
        const res = await fetchWith(setup, (ctx) => ctx.res)
        expect(res).toEqual({ status: 200, type: null, body: '' })
      })
    })
  }
})
