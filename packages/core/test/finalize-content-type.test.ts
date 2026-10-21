import { describe, expect, it } from 'bun:test'
import { Miia, type Middleware, type RequestContext } from '../src/index.js'

type Handler = (ctx: RequestContext) => unknown

const passThrough: Middleware = async (_ctx, next) => {
  await next()
}

// Each one reaches the result through its own tail in app.ts: finalizeResponse() straight from the handler,
// finalizePipelineResult() after a route middleware, and the same after a global one
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
