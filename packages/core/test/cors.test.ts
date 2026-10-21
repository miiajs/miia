import { describe, expect, it } from 'bun:test'
import type { Middleware } from '../src/index.js'
import { Controller, cors, Get, Miia, Module, Options } from '../src/index.js'

function appWith(...middlewares: Middleware[]): Miia {
  @Controller('/cors')
  class Ctrl {
    @Get()
    index() {
      return { ok: true }
    }

    @Options('/own')
    own() {
      return { own: true }
    }
  }

  @Module({ controllers: [Ctrl] })
  class M {}

  return new Miia({ logger: false }).register(M).use(...middlewares)
}

async function get(app: Miia, origin?: string): Promise<Response> {
  return app.fetch(new Request('http://localhost/cors', { headers: origin ? { origin } : {} }))
}

async function options(app: Miia, path: string, headers: Record<string, string>): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, { method: 'OPTIONS', headers }))
}

const setVary =
  (value: string): Middleware =>
  async (ctx, next) => {
    ctx.res.header('Vary', value)
    await next()
  }

describe('cors()', () => {
  it("throws when 'credentials: true' is combined with 'origin: \"*\"'", () => {
    expect(() => cors({ origin: '*', credentials: true })).toThrow(/credentials: true.*incompatible.*origin/)
  })

  it('allows \'origin: "*"\' without credentials (default)', () => {
    expect(() => cors({ origin: '*' })).not.toThrow()
  })

  it('allows explicit origin string with credentials', () => {
    expect(() => cors({ origin: 'https://example.com', credentials: true })).not.toThrow()
  })

  it('allows origin array with credentials', () => {
    expect(() => cors({ origin: ['https://a.com', 'https://b.com'], credentials: true })).not.toThrow()
  })

  it('allows origin function with credentials', () => {
    expect(() => cors({ origin: (o) => o === 'https://example.com', credentials: true })).not.toThrow()
  })

  it('defaults to safe config when no options passed', () => {
    expect(() => cors()).not.toThrow()
  })
})

describe('cors() - Vary', () => {
  it('sends Vary: Origin when an origin list allows the request', async () => {
    const res = await get(appWith(cors({ origin: ['https://a.com'] })), 'https://a.com')
    expect(res.headers.get('access-control-allow-origin')).toBe('https://a.com')
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('sends Vary: Origin when an origin list refuses the request', async () => {
    const res = await get(appWith(cors({ origin: ['https://a.com'] })), 'https://evil.com')
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('sends Vary: Origin when the request has no Origin', async () => {
    const res = await get(appWith(cors({ origin: ['https://a.com'] })))
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('sends Vary: Origin when an origin predicate refuses the request', async () => {
    const res = await get(appWith(cors({ origin: (o) => o === 'https://a.com' })), 'https://evil.com')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('adds Origin to a Vary an earlier middleware set', async () => {
    const res = await get(appWith(setVary('Accept-Encoding'), cors({ origin: ['https://a.com'] })), 'https://a.com')
    expect(res.headers.get('vary')).toBe('Accept-Encoding, Origin')
  })

  it('does not repeat an Origin that Vary already lists', async () => {
    const res = await get(
      appWith(setVary('accept-encoding, origin'), cors({ origin: ['https://a.com'] })),
      'https://a.com',
    )
    expect(res.headers.get('vary')).toBe('accept-encoding, origin')
  })

  it('leaves Vary: * as it is', async () => {
    const res = await get(appWith(setVary('*'), cors({ origin: ['https://a.com'] })), 'https://a.com')
    expect(res.headers.get('vary')).toBe('*')
  })

  it('sends no Vary for \'origin: "*"\'', async () => {
    const res = await get(appWith(cors()), 'https://a.com')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('vary')).toBeNull()
  })
})

describe('cors() - preflight', () => {
  const preflight = { origin: 'https://a.com', 'access-control-request-method': 'PUT' }

  it('answers an OPTIONS with Origin and Access-Control-Request-Method with 204', async () => {
    const res = await options(appWith(cors({ origin: ['https://a.com'], maxAge: 600 })), '/cors', preflight)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://a.com')
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS')
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type, Authorization')
    expect(res.headers.get('access-control-max-age')).toBe('600')
  })

  it('answers a preflight before an @Options route', async () => {
    const res = await options(appWith(cors()), '/cors/own', preflight)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('passes an OPTIONS without Access-Control-Request-Method to its @Options route', async () => {
    const res = await options(appWith(cors({ origin: ['https://a.com'] })), '/cors/own', { origin: 'https://a.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ own: true })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://a.com')
    expect(res.headers.get('vary')).toBe('Origin')
    expect(res.headers.get('access-control-allow-methods')).toBeNull()
    expect(res.headers.get('access-control-max-age')).toBeNull()
  })

  it('passes an OPTIONS without Origin to its @Options route', async () => {
    const res = await options(appWith(cors()), '/cors/own', { 'access-control-request-method': 'PUT' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ own: true })
    expect(res.headers.get('access-control-allow-methods')).toBeNull()
  })

  it('lets an OPTIONS that is not a preflight reach a 404, with the CORS headers', async () => {
    const res = await options(appWith(cors({ origin: ['https://a.com'] })), '/cors', { origin: 'https://a.com' })
    expect(res.status).toBe(404)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://a.com')
    expect(res.headers.get('access-control-allow-methods')).toBeNull()
  })
})
