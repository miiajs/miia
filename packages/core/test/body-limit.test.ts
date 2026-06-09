import { describe, it, expect } from 'bun:test'
import { Miia } from '../src/app/index.js'
import { Controller, Module, Get, Post, BodyLimit, ValidateBody, Use } from '../src/decorators/index.js'
import { PayloadTooLargeException } from '../src/exceptions.js'
import { countingLimitStream, applyBodyCeiling, DEFAULT_BODY_LIMIT } from '../src/body-limit.js'
import type { Middleware, RequestContext } from '../src/types.js'

async function request(
  app: Miia,
  method: string,
  path: string,
  options: { body?: string; headers?: Record<string, string> } = {},
) {
  // Bun does not auto-add content-length to constructed Requests (unlike real
  // HTTP requests received by a server), so set it explicitly for the check.
  const headers: Record<string, string> = { ...options.headers }
  if (typeof options.body === 'string' && headers['content-length'] === undefined) {
    headers['content-length'] = String(new TextEncoder().encode(options.body).byteLength)
  }
  const req = new Request(`http://localhost${path}`, {
    method,
    body: options.body,
    headers,
  })
  return app.fetch(req)
}

/** Request with a real string body of `bytes` length (CL set by the runtime). */
function bigBody(bytes: number): string {
  return 'x'.repeat(bytes)
}

describe('body limit - app-level maxBodySize', () => {
  it('rejects POST with Content-Length over the default 1MB limit with 413', async () => {
    @Controller('/')
    class Ctrl {
      @Post('/items')
      create() {
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false }).register(M)
    const res = await request(app, 'POST', '/items', { body: bigBody(DEFAULT_BODY_LIMIT + 1) })
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.statusCode).toBe(413)
    expect(json.error).toBe('Payload Too Large')
  })

  it('accepts POST under the limit', async () => {
    @Controller('/')
    class Ctrl {
      @Post('/items')
      create() {
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false }).register(M)
    const res = await request(app, 'POST', '/items', { body: '{"a":1}' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('does not check GET requests even with a huge Content-Length header', async () => {
    @Controller('/')
    class Ctrl {
      @Get('/items')
      list() {
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false }).register(M)
    const res = await request(app, 'GET', '/items', { headers: { 'content-length': '99999999' } })
    expect(res.status).toBe(200)
  })

  it('maxBodySize: false disables the check entirely', async () => {
    @Controller('/')
    class Ctrl {
      @Post('/items')
      create() {
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false, maxBodySize: false }).register(M)
    const res = await request(app, 'POST', '/items', { body: bigBody(2 * DEFAULT_BODY_LIMIT) })
    expect(res.status).toBe(200)
  })

  it('maxBodySize lowers the default for all routes', async () => {
    @Controller('/')
    class Ctrl {
      @Post('/items')
      create() {
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false, maxBodySize: 100 }).register(M)
    const res = await request(app, 'POST', '/items', { body: bigBody(101) })
    expect(res.status).toBe(413)

    const ok = await request(app, 'POST', '/items', { body: bigBody(100) })
    expect(ok.status).toBe(200)
  })
})

describe('body limit - @BodyLimit decorator', () => {
  it('method-level @BodyLimit overrides the app default', async () => {
    @Controller('/')
    class Ctrl {
      @Post('/tiny')
      @BodyLimit(10)
      tiny() {
        return { ok: true }
      }

      @Post('/normal')
      normal() {
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false }).register(M)

    const tooBig = await request(app, 'POST', '/tiny', { body: bigBody(20) })
    expect(tooBig.status).toBe(413)

    const normal = await request(app, 'POST', '/normal', { body: bigBody(20) })
    expect(normal.status).toBe(200)
  })

  it('class-level @BodyLimit applies to all methods; method-level wins both directions', async () => {
    @Controller('/')
    @BodyLimit(50)
    class Ctrl {
      @Post('/a')
      a() {
        return { ok: true }
      }

      @Post('/smaller')
      @BodyLimit(10)
      smaller() {
        return { ok: true }
      }

      @Post('/bigger')
      @BodyLimit(200)
      bigger() {
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false }).register(M)

    expect((await request(app, 'POST', '/a', { body: bigBody(60) })).status).toBe(413)
    expect((await request(app, 'POST', '/a', { body: bigBody(50) })).status).toBe(200)

    expect((await request(app, 'POST', '/smaller', { body: bigBody(20) })).status).toBe(413)
    expect((await request(app, 'POST', '/bigger', { body: bigBody(150) })).status).toBe(200)
  })

  it('@BodyLimit larger than the global default lets big bodies through on that route only', async () => {
    @Controller('/')
    class Ctrl {
      @Post('/upload')
      @BodyLimit(50 * 1024 * 1024)
      upload() {
        return { ok: true }
      }

      @Post('/plain')
      plain() {
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false }).register(M)
    const big = bigBody(2 * DEFAULT_BODY_LIMIT)

    expect((await request(app, 'POST', '/upload', { body: big })).status).toBe(200)
    expect((await request(app, 'POST', '/plain', { body: big })).status).toBe(413)
  })

  it('throws TypeError for invalid byte values at class-definition time', () => {
    expect(() => {
      @Controller('/')
      class _Bad {
        @Post('/x')
        @BodyLimit(-1)
        x() {}
      }
    }).toThrow(TypeError)

    expect(() => {
      @Controller('/')
      class _AlsoBad {
        @Post('/x')
        @BodyLimit(Number.NaN)
        x() {}
      }
    }).toThrow(TypeError)
  })
})

describe('body limit - global middleware pipeline', () => {
  it('413 bubbles through the onion and is observable by global middleware', async () => {
    let observed: unknown = null
    const mw: Middleware = async (_ctx, next) => {
      try {
        await next()
      } catch (e) {
        observed = e
        throw e
      }
    }

    @Controller('/')
    class Ctrl {
      @Post('/items')
      create() {
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false, maxBodySize: 10 }).register(M).use(mw)
    const res = await request(app, 'POST', '/items', { body: bigBody(20) })
    expect(res.status).toBe(413)
    expect(observed).toBeInstanceOf(PayloadTooLargeException)
  })
})

describe('body limit - adapter error contract', () => {
  it("maps an Error named 'PayloadTooLargeError' thrown by a handler to 413", async () => {
    @Controller('/')
    class Ctrl {
      @Post('/items')
      create() {
        // Simulates node-server/uws-server erroring the body stream mid-read
        throw Object.assign(new Error('Request body exceeded 100 byte limit'), {
          name: 'PayloadTooLargeError',
        })
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false }).register(M)
    const res = await request(app, 'POST', '/items', { body: '{}' })
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.error).toBe('Payload Too Large')
    expect(json.message).toBe('Request body exceeded 100 byte limit')
  })

  it('@ValidateBody rethrows the body-limit error as 413 instead of degrading to 422', async () => {
    const schema = {
      safeParse(value: unknown) {
        return { success: true as const, data: value }
      },
    }

    @Controller('/')
    class Ctrl {
      @Post('/items')
      @ValidateBody(schema)
      create(_ctx: RequestContext) {
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false, maxBodySize: false }).register(M)

    // Chunked request (stream body, no CL) wrapped by the Deno-style ceiling:
    // ctx.json() inside @ValidateBody hits the counting stream's 413.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(200)))
        controller.close()
      },
    })
    const raw = new Request('http://localhost/items', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    const capped = applyBodyCeiling(raw, 100)

    const res = await app.fetch(capped)
    expect(res.status).toBe(413)
  })
})

describe('countingLimitStream', () => {
  it('errors with PayloadTooLargeException once the limit is exceeded', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60))
        controller.enqueue(new Uint8Array(60))
        controller.close()
      },
    })
    const limited = source.pipeThrough(countingLimitStream(100))
    const reader = limited.getReader()

    await reader.read() // first 60 bytes pass
    expect(reader.read()).rejects.toBeInstanceOf(PayloadTooLargeException)
  })

  it('passes bytes through intact under the limit', async () => {
    const payload = new TextEncoder().encode('hello world')
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload)
        controller.close()
      },
    })
    const limited = source.pipeThrough(countingLimitStream(100))
    const text = await new Response(limited).text()
    expect(text).toBe('hello world')
  })
})

describe('applyBodyCeiling', () => {
  it('returns the same Request object when Content-Length is present', () => {
    const req = new Request('http://localhost/items', {
      method: 'POST',
      body: 'hello',
      headers: { 'content-length': '5' },
    })
    expect(req.headers.has('content-length')).toBe(true)
    expect(applyBodyCeiling(req, 100)).toBe(req)
  })

  it('returns the same Request object for bodyless requests', () => {
    const req = new Request('http://localhost/items', { method: 'GET' })
    expect(applyBodyCeiling(req, 100)).toBe(req)
  })

  it('re-wraps chunked requests preserving method, url and headers', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hi'))
        controller.close()
      },
    })
    const raw = new Request('http://localhost/items?q=1', {
      method: 'POST',
      body: stream,
      headers: { 'x-custom': 'yes' },
      duplex: 'half',
    } as RequestInit)
    expect(raw.headers.has('content-length')).toBe(false)

    const wrapped = applyBodyCeiling(raw, 100)
    expect(wrapped).not.toBe(raw)
    expect(wrapped.method).toBe('POST')
    expect(wrapped.url).toBe('http://localhost/items?q=1')
    expect(wrapped.headers.get('x-custom')).toBe('yes')
    expect(await wrapped.text()).toBe('hi')
  })

  it('makes oversized chunked bodies reject and the app respond 413', async () => {
    @Controller('/')
    class Ctrl {
      @Post('/items')
      async create(ctx: RequestContext) {
        await ctx.text()
        return { ok: true }
      }
    }
    @Module({ controllers: [Ctrl] })
    class M {}

    const app = new Miia({ logger: false, maxBodySize: false }).register(M)

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(200)))
        controller.close()
      },
    })
    const raw = new Request('http://localhost/items', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    const capped = applyBodyCeiling(raw, 100)

    expect(capped.text()).rejects.toBeInstanceOf(PayloadTooLargeException)

    // Fresh request for the full fetch round-trip (body already consumed above)
    const stream2 = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(200)))
        controller.close()
      },
    })
    const raw2 = new Request('http://localhost/items', {
      method: 'POST',
      body: stream2,
      duplex: 'half',
    } as RequestInit)
    const res = await app.fetch(applyBodyCeiling(raw2, 100))
    expect(res.status).toBe(413)
  })
})
