import { afterEach, describe, expect, it } from 'bun:test'
import { once } from 'node:events'
import * as http from 'node:http'
import * as net from 'node:net'
import { Miia, type RequestContext } from '@miiajs/core'
import { serve, type ServerHandle } from '../src/index.js'

function request(
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string | string[]> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (res: http.IncomingMessage) => {
        let body = ''
        res.on('data', (chunk: Buffer) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }))
      },
    )
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

let nextPort = 18234

describe('node-server', () => {
  let server: ServerHandle

  afterEach(async () => {
    if (server) await server.close()
  })

  // ── GET requests ──────────────────────────────────────────

  describe('GET requests', () => {
    it('should handle GET and return path and method', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: (req) => {
          const url = new URL(req.url)
          return new Response(JSON.stringify({ path: url.pathname, method: req.method }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      const res = await request(`http://localhost:${port}/hello`)
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.path).toBe('/hello')
      expect(body.method).toBe('GET')
    })

    it('should include query string in URL', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: (req) => {
          const url = new URL(req.url)
          return new Response(JSON.stringify({ foo: url.searchParams.get('foo'), baz: url.searchParams.get('baz') }))
        },
      })

      const res = await request(`http://localhost:${port}/search?foo=bar&baz=1`)
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.foo).toBe('bar')
      expect(body.baz).toBe('1')
    })

    it('should construct URL using host header', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: (req) => new Response(req.url),
      })

      const res = await request(`http://localhost:${port}/path`, {
        headers: { Host: 'myapp.local:9999' },
      })
      expect(res.body).toBe('http://myapp.local:9999/path')
    })
  })

  // ── POST requests - buffer path ──────────────────────────

  describe('POST requests - buffer path', () => {
    it('should handle POST with JSON body via req.json()', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: async (req) => {
          const body = await req.json()
          return new Response(JSON.stringify({ received: body }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      const res = await request(`http://localhost:${port}/data`, {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.received).toEqual({ name: 'test' })
    })

    it('should handle POST with text body via req.text()', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: async (req) => {
          const text = await req.text()
          return new Response(text)
        },
      })

      const res = await request(`http://localhost:${port}/text`, {
        method: 'POST',
        body: 'hello world',
        headers: { 'Content-Type': 'text/plain' },
      })
      expect(res.status).toBe(200)
      expect(res.body).toBe('hello world')
    })

    it('should handle POST with Content-Length: 0', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: async (req) => {
          const text = await req.text()
          return new Response(JSON.stringify({ empty: text === '' }))
        },
      })

      const res = await request(`http://localhost:${port}/empty`, {
        method: 'POST',
        headers: { 'Content-Length': '0' },
      })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).empty).toBe(true)
    })
  })

  // ── POST requests - stream path ──────────────────────────

  describe('POST requests - stream path', () => {
    it('should stream body when Content-Length exceeds bufferThreshold', async () => {
      const port = nextPort++
      server = await serve({
        port,
        bufferThreshold: 16,
        fetch: async (req) => {
          const text = await req.text()
          return new Response(JSON.stringify({ length: text.length, text }))
        },
      })

      const payload = 'this is a body that exceeds 16 bytes threshold'
      const res = await request(`http://localhost:${port}/large`, {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'text/plain', 'Content-Length': `${Buffer.byteLength(payload)}` },
      })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).text).toBe(payload)
    })

    it('should stream body when Content-Length is missing', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: async (req) => {
          const text = await req.text()
          return new Response(text)
        },
      })

      const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
        (resolve, reject) => {
          const req = http.request(
            {
              hostname: 'localhost',
              port,
              path: '/chunked',
              method: 'POST',
              headers: { 'Transfer-Encoding': 'chunked' },
            },
            (res) => {
              let body = ''
              res.on('data', (chunk: Buffer) => (body += chunk))
              res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }))
            },
          )
          req.on('error', reject)
          req.write('chunked ')
          req.write('data')
          req.end()
        },
      )
      expect(res.status).toBe(200)
      expect(res.body).toBe('chunked data')
    })
  })

  // ── HEAD requests ─────────────────────────────────────────

  describe('HEAD requests', () => {
    it('should handle HEAD request without body', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => new Response('ok', { status: 200, headers: { 'X-Test': 'head' } }),
      })

      const res = await request(`http://localhost:${port}/test`, { method: 'HEAD' })
      expect(res.status).toBe(200)
      expect(res.body).toBe('')
      expect(res.headers['x-test']).toBe('head')
    })
  })

  // ── Response types ───────────────────────────────────────

  describe('response types', () => {
    it('should return custom status, headers, and auto-set Content-Length', async () => {
      const port = nextPort++
      const body = 'created'
      server = await serve({
        port,
        fetch: () =>
          new Response(body, {
            status: 201,
            headers: { 'X-Custom': 'value', 'Content-Type': 'text/plain' },
          }),
      })

      const res = await request(`http://localhost:${port}/test`)
      expect(res.status).toBe(201)
      expect(res.headers['x-custom']).toBe('value')
      expect(res.headers['content-length']).toBe(`${Buffer.byteLength(body)}`)
      expect(res.body).toBe('created')
    })

    it('should return null body with 204 status', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => new Response(null, { status: 204 }),
      })

      const res = await request(`http://localhost:${port}/no-content`)
      expect(res.status).toBe(204)
      expect(res.body).toBe('')
    })

    it('should return Uint8Array body', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => new Response(new Uint8Array([72, 101, 108, 108, 111])),
      })

      const res = await request(`http://localhost:${port}/binary`)
      expect(res.status).toBe(200)
      expect(res.body).toBe('Hello')
    })

    it('should return streaming ReadableStream body', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => {
          const encoder = new TextEncoder()
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('chunk1'))
              controller.enqueue(encoder.encode('chunk2'))
              controller.enqueue(encoder.encode('chunk3'))
              controller.close()
            },
          })
          return new Response(stream, { headers: { 'Content-Type': 'text/plain' } })
        },
      })

      const res = await request(`http://localhost:${port}/stream`)
      expect(res.status).toBe(200)
      expect(res.body).toBe('chunk1chunk2chunk3')
    })

    it('should forward multiple same-name response headers', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => {
          const headers = new Headers()
          headers.append('Set-Cookie', 'a=1')
          headers.append('Set-Cookie', 'b=2')
          return new Response('ok', { headers })
        },
      })

      const res = await request(`http://localhost:${port}/cookies`)
      expect(res.status).toBe(200)
      const cookies = res.headers['set-cookie']
      expect(Array.isArray(cookies)).toBe(true)
      expect(cookies).toContain('a=1')
      expect(cookies).toContain('b=2')
    })
  })

  // ── LightResponse static methods ─────────────────────────

  describe('LightResponse static methods', () => {
    it('should handle Response.json() with correct content-type', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => Response.json({ ok: true }),
      })

      const res = await request(`http://localhost:${port}/json`)
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true })
      expect(res.headers['content-type']).toBe('application/json')
    })

    it('should handle Response.redirect()', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => Response.redirect('/new-location'),
      })

      const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
        (resolve, reject) => {
          const req = http.request({ hostname: 'localhost', port, path: '/old', method: 'GET' }, (res) => {
            let body = ''
            res.on('data', (chunk: Buffer) => (body += chunk))
            res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }))
          })
          req.on('error', reject)
          req.end()
        },
      )
      expect(res.status).toBe(302)
      expect(res.headers['location']).toBe('/new-location')
    })
  })

  // ── Request headers ───────────────────────────────────────

  describe('request headers', () => {
    it('should access headers case-insensitively', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: (req) => {
          const lower = req.headers.get('x-custom')
          const upper = req.headers.get('X-Custom')
          const mixed = req.headers.get('X-CUSTOM')
          return Response.json({ lower, upper, mixed })
        },
      })

      const res = await request(`http://localhost:${port}/headers`, {
        headers: { 'X-Custom': 'test-value' },
      })
      const body = JSON.parse(res.body)
      expect(body.lower).toBe('test-value')
      expect(body.upper).toBe('test-value')
      expect(body.mixed).toBe('test-value')
    })

    it('should concatenate multiple same-name headers with comma', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: (req) => {
          const accept = req.headers.get('accept')
          return Response.json({ accept })
        },
      })

      const res = await request(`http://localhost:${port}/multi`, {
        headers: { Accept: ['text/html', 'application/json'] as any },
      })
      const body = JSON.parse(res.body)
      expect(body.accept).toContain('text/html')
      expect(body.accept).toContain('application/json')
    })
  })

  // ── Host header that makes no valid URL ───────────────────

  describe('a Host header that makes no valid URL', () => {
    /** A chunked `hello` under `host`, on a connection of its own - the answer is read to the close. */
    async function post(port: number, host: string): Promise<{ status: number; body: string }> {
      const socket = net.connect(port, '127.0.0.1')
      await once(socket, 'connect')
      const chunks: Buffer[] = []
      socket.on('data', (chunk: Buffer) => chunks.push(chunk))
      const closed = once(socket, 'close')
      socket.write(
        `POST /p?q=1 HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n` +
          '5\r\nhello\r\n0\r\n\r\n',
      )
      await closed
      const text = Buffer.concat(chunks).toString()
      const sep = text.indexOf('\r\n\r\n')
      return { status: Number(text.split(' ')[1]), body: text.slice(sep + 4) }
    }

    /** Answers with the URL and the body it read, under a Content-Length so that native mode does not chunk it. */
    async function echo(req: Request): Promise<Response> {
      const json = JSON.stringify({ url: req.url, text: await req.text() })
      return new Response(json, { headers: { 'content-length': String(Buffer.byteLength(json)) } })
    }

    for (const host of ['x:99999', '[::1']) {
      it(`optimized mode: the body is read under Host ${host}, and req.url keeps it as Bun and Deno do`, async () => {
        const port = nextPort++
        server = await serve({ port, fetch: echo })
        const res = await post(port, host)
        expect(res.status).toBe(200)
        expect(JSON.parse(res.body)).toEqual({ url: `http://${host}/p?q=1`, text: 'hello' })
      })

      it(`native mode: the request under Host ${host} is built on http://localhost`, async () => {
        const port = nextPort++
        server = await serve({ port, mode: 'native', fetch: echo })
        const res = await post(port, host)
        expect(res.status).toBe(200)
        expect(JSON.parse(res.body)).toEqual({ url: 'http://localhost/p?q=1', text: 'hello' })
      })
    }
  })

  // ── Request body consumers ────────────────────────────────

  describe('request body consumers', () => {
    it('should track bodyUsed after consumption', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: async (req) => {
          const before = req.bodyUsed
          await req.json()
          const after = req.bodyUsed
          return Response.json({ before, after })
        },
      })

      const res = await request(`http://localhost:${port}/used`, {
        method: 'POST',
        body: JSON.stringify({ x: 1 }),
        headers: { 'Content-Type': 'application/json' },
      })
      const body = JSON.parse(res.body)
      expect(body.before).toBe(false)
      expect(body.after).toBe(true)
    })

    it('should read body via req.arrayBuffer()', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: async (req) => {
          const ab = await req.arrayBuffer()
          const text = new TextDecoder().decode(ab)
          return Response.json({ text, byteLength: ab.byteLength })
        },
      })

      const payload = 'arraybuffer test'
      const res = await request(`http://localhost:${port}/ab`, {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'text/plain' },
      })
      const body = JSON.parse(res.body)
      expect(body.text).toBe(payload)
      expect(body.byteLength).toBe(Buffer.byteLength(payload))
    })

    it('should return ReadableStream from req.body on buffer path', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: async (req) => {
          const stream = req.body
          if (!stream) return Response.json({ hasBody: false })
          const reader = stream.getReader()
          const chunks: Uint8Array[] = []
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
          }
          const merged = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
          let offset = 0
          for (const c of chunks) {
            merged.set(c, offset)
            offset += c.length
          }
          return Response.json({ text: new TextDecoder().decode(merged) })
        },
      })

      const res = await request(`http://localhost:${port}/body-stream`, {
        method: 'POST',
        body: 'stream from body getter',
        headers: { 'Content-Type': 'text/plain' },
      })
      const body = JSON.parse(res.body)
      expect(body.text).toBe('stream from body getter')
    })
  })

  // ── Body read once ────────────────────────────────────────

  describe('body read once, like a real Request', () => {
    // One part goes out with Content-Length (buffer path), several with chunked framing (stream path)
    const paths = [
      ['buffer', ['hello'], ['"hello"']],
      ['stream', ['hel', 'lo'], ['"hel', 'lo"']],
    ] as const

    async function exchange(parts: readonly string[], handler: (ctx: RequestContext) => unknown): Promise<any> {
      const app = new Miia({ logger: false })
      app.addRoute('POST', '/', handler)
      const port = nextPort++
      server = await serve({ port, fetch: app.fetch })
      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: 'localhost',
            port,
            path: '/',
            method: 'POST',
            headers:
              parts.length > 1
                ? { 'Transfer-Encoding': 'chunked' }
                : { 'Content-Length': String(Buffer.byteLength(parts[0]!)) },
          },
          (res) => {
            let body = ''
            res.on('data', (chunk: Buffer) => (body += chunk))
            res.on('end', () => resolve({ status: res.statusCode!, body }))
          },
        )
        req.on('error', reject)
        for (const part of parts) req.write(part)
        req.end()
      })
      expect(res.status).toBe(200)
      return JSON.parse(res.body)
    }

    async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
      const reader = stream.getReader()
      let text = ''
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) return text + decoder.decode()
        text += decoder.decode(value, { stream: true })
      }
    }

    /** How a body read settled: its value, or the error it rejected with. */
    async function outcome(read: () => Promise<unknown>): Promise<string> {
      try {
        const value = await read()
        return `resolved ${value instanceof ArrayBuffer ? value.byteLength : String(value)}`
      } catch (error) {
        return `${(error as Error).name}: ${(error as Error).message}`
      }
    }

    // The buffer path rejects with Node's own message; the stream path hands over the runtime's Request, whose
    // message differs (Bun: "Body already used")
    const BODY_USED = /^TypeError: Body (is unusable|already used)/

    for (const [path, parts, jsonParts] of paths) {
      it(`${path} path: ctx.req.arrayBuffer() after ctx.text() rejects with a TypeError`, async () => {
        const body = await exchange(parts, async (ctx) => {
          const text = await ctx.text()
          return { text, second: await outcome(() => ctx.req.arrayBuffer()), bodyUsed: ctx.req.bodyUsed }
        })
        expect(body.text).toBe('hello')
        expect(body.second).toMatch(BODY_USED)
        expect(body.bodyUsed).toBe(true)
      })

      it(`${path} path: ctx.req.text() twice - the second call rejects`, async () => {
        const body = await exchange(parts, async (ctx) => {
          const first = await ctx.req.text()
          return { first, second: await outcome(() => ctx.req.text()) }
        })
        expect(body.first).toBe('hello')
        expect(body.second).toMatch(BODY_USED)
      })

      it(`${path} path: a read of ctx.req.body takes the body, ctx.text() after it rejects`, async () => {
        const body = await exchange(parts, async (ctx) => {
          const before = ctx.req.bodyUsed
          const raw = await readAll(ctx.req.body!)
          return { raw, before, after: ctx.req.bodyUsed, text: await outcome(() => ctx.text()) }
        })
        expect(body).toMatchObject({ raw: 'hello', before: false, after: true })
        expect(body.text).toMatch(BODY_USED)
      })

      it(`${path} path: ctx.req.body handed out but not read leaves the body to ctx.text()`, async () => {
        const body = await exchange(parts, async (ctx) => {
          const stream = ctx.req.body!
          return { text: await ctx.text(), bodyUsed: ctx.req.bodyUsed, locked: stream.locked }
        })
        expect(body).toMatchObject({ text: 'hello', bodyUsed: true })
        // Bun's own Request leaves a consumed stream body unlocked
        if (path === 'buffer') expect(body.locked).toBe(true)
      })

      it(`${path} path: ctx.json() and ctx.text() still share one read`, async () => {
        const body = await exchange(jsonParts, async (ctx) => ({
          json: await ctx.json(),
          text: await ctx.text(),
          again: await ctx.json(),
        }))
        expect(body).toEqual({ json: 'hello', text: '"hello"', again: 'hello' })
      })

      it(`${path} path: ctx.req.bytes() reads the body into bytes of its own, once`, async () => {
        const body = await exchange(parts, async (ctx) => {
          const bytes = await ctx.req.bytes()
          return {
            text: new TextDecoder().decode(bytes),
            own: bytes instanceof Uint8Array && bytes.buffer.byteLength === bytes.byteLength,
            second: await outcome(() => ctx.req.bytes()),
          }
        })
        expect(body).toMatchObject({ text: 'hello', own: true })
        expect(body.second).toMatch(BODY_USED)
      })

      it(`${path} path: clone() after ctx.text() throws a TypeError`, async () => {
        const body = await exchange(parts, async (ctx) => {
          await ctx.text()
          return { clone: await outcome(async () => ctx.req.clone()) }
        })
        // Bun's own Request words it differently from Node's
        expect(body.clone).toMatch(/^TypeError: (unusable|Body is disturbed or locked)$/)
      })

      it(`${path} path: a clone taken before the body is read reads it too`, async () => {
        const body = await exchange(parts, async (ctx) => {
          const copy = ctx.req.clone()
          return { text: await ctx.text(), copy: await copy.text() }
        })
        expect(body).toEqual({ text: 'hello', copy: 'hello' })
      })
    }

    it('buffer path: every consumer after ctx.text() rejects and the body stream is locked', async () => {
      const body = await exchange(['hello'], async (ctx) => {
        await ctx.text()
        let reader: string
        try {
          ctx.req.body!.getReader()
          reader = 'unlocked'
        } catch (error) {
          reader = (error as Error).name
        }
        return {
          json: await outcome(() => ctx.req.json()),
          text: await outcome(() => ctx.req.text()),
          arrayBuffer: await outcome(() => ctx.req.arrayBuffer()),
          blob: await outcome(() => ctx.req.blob()),
          formData: await outcome(() => ctx.req.formData()),
          reader,
        }
      })
      const message = 'TypeError: Body is unusable: Body has already been read'
      expect(body).toEqual({
        json: message,
        text: message,
        arrayBuffer: message,
        blob: message,
        formData: message,
        reader: 'TypeError',
      })
    })
  })

  // ── Error handling ────────────────────────────────────────

  describe('error handling', () => {
    it('should return 500 when handler throws synchronously', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => {
          throw new Error('sync boom')
        },
      })

      const res = await request(`http://localhost:${port}/error`)
      expect(res.status).toBe(500)
      const body = JSON.parse(res.body)
      expect(body.statusCode).toBe(500)
      expect(body.message).toBe('Internal Server Error')
    })

    it('should return 500 when handler returns rejected promise', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => Promise.reject(new Error('async boom')),
      })

      const res = await request(`http://localhost:${port}/error`)
      expect(res.status).toBe(500)
      const body = JSON.parse(res.body)
      expect(body.statusCode).toBe(500)
      expect(body.message).toBe('Internal Server Error')
    })
  })

  // ── Native mode ───────────────────────────────────────────

  describe('native mode', () => {
    it('should handle GET in native mode', async () => {
      const port = nextPort++
      server = await serve({
        port,
        mode: 'native',
        fetch: (req) => {
          const url = new URL(req.url)
          return new Response(JSON.stringify({ path: url.pathname, method: req.method }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      const res = await request(`http://localhost:${port}/native`)
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.path).toBe('/native')
      expect(body.method).toBe('GET')
    })

    it('should handle POST with body in native mode', async () => {
      const port = nextPort++
      server = await serve({
        port,
        mode: 'native',
        fetch: async (req) => {
          const body = await req.json()
          return new Response(JSON.stringify({ received: body }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      const res = await request(`http://localhost:${port}/data`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'native' }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).received).toEqual({ mode: 'native' })
    })

    it('should forward response headers in native mode', async () => {
      const port = nextPort++
      server = await serve({
        port,
        mode: 'native',
        fetch: () =>
          new Response('ok', {
            status: 201,
            headers: { 'X-Native': 'yes', 'Content-Type': 'text/plain' },
          }),
      })

      const res = await request(`http://localhost:${port}/headers`)
      expect(res.status).toBe(201)
      expect(res.headers['x-native']).toBe('yes')
      expect(res.body).toBe('ok')
    })
  })

  // ── Options ───────────────────────────────────────────────

  describe('options', () => {
    it('should use custom bufferThreshold to force stream path', async () => {
      const port = nextPort++
      server = await serve({
        port,
        bufferThreshold: 8,
        fetch: async (req) => {
          const text = await req.text()
          return Response.json({ text })
        },
      })

      const payload = 'this exceeds 8 bytes'
      const res = await request(`http://localhost:${port}/threshold`, {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'text/plain', 'Content-Length': `${Buffer.byteLength(payload)}` },
      })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).text).toBe(payload)
    })
  })

  // ── Lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should restore globalThis.Response after close in optimized mode', async () => {
      const Original = globalThis.Response
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => new Response('ok'),
      })

      expect(globalThis.Response).not.toBe(Original)
      await server.close()
      expect(globalThis.Response).toBe(Original)
      server = undefined as any // prevent afterEach double-close
    })
  })

  // ── connection reuse ──────────────────────────────────────

  describe('connection reuse', () => {
    it('closes the connection when the handler left the request body unread', async () => {
      const port = nextPort++
      server = await serve({ port, fetch: () => new Response('ok') })

      const res = await request(`http://localhost:${port}/upload`, {
        method: 'POST',
        body: 'x'.repeat(200_000),
      })
      expect(res.status).toBe(200)
      // RFC 9112 section 9.6 - unread bytes are still on the socket, so the
      // connection cannot carry the next request.
      expect(res.headers.connection).toBe('close')
    })

    it('keeps the connection when the handler consumed the body', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: async (req) => new Response(String((await req.text()).length)),
      })

      const res = await request(`http://localhost:${port}/upload`, {
        method: 'POST',
        body: 'x'.repeat(200_000),
      })
      expect(res.body).toBe('200000')
      expect(res.headers.connection).not.toBe('close')
    })

    it('keeps the connection on a GET, which has nothing to read', async () => {
      const port = nextPort++
      server = await serve({ port, fetch: () => new Response('ok') })

      const res = await request(`http://localhost:${port}/`)
      expect(res.status).toBe(200)
      expect(res.headers.connection).not.toBe('close')
    })
  })

  // ── maxBodySize ───────────────────────────────────────────

  describe('maxBodySize', () => {
    // Note: Bun's node:http client recomputes Content-Length from the actual
    // body bytes (an explicit mismatched header is overwritten), so oversized-CL
    // cases send real bodies. Chunked framing requires Transfer-Encoding AND
    // multiple write() calls - a single write+end is coalesced into CL framing.

    function chunkedRequest(url: string, parts: string[]): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const parsed = new URL(url)
        const req = http.request(
          {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname,
            method: 'POST',
            headers: { 'Transfer-Encoding': 'chunked' },
          },
          (res) => {
            let body = ''
            res.on('data', (chunk: Buffer) => (body += chunk))
            res.on('end', () => resolve({ status: res.statusCode!, body }))
          },
        )
        req.on('error', reject)
        for (const part of parts) req.write(part)
        req.end()
      })
    }

    it('should reject declared Content-Length over the cap with immediate 413, handler never runs', async () => {
      const port = nextPort++
      let handlerCalled = false
      server = await serve({
        port,
        maxBodySize: 1000,
        fetch: () => {
          handlerCalled = true
          return new Response('ok')
        },
      })

      const res = await request(`http://localhost:${port}/upload`, {
        method: 'POST',
        body: 'x'.repeat(5000),
        headers: { 'content-length': '5000' },
      })
      expect(res.status).toBe(413)
      expect(JSON.parse(res.body)).toEqual({
        statusCode: 413,
        error: 'Payload Too Large',
        message: 'Payload Too Large',
      })
      expect(handlerCalled).toBe(false)
    })

    // On Node this is test/early-413.node.test.ts (`bun run test:node-server`); here it keeps Bun's node:http, which
    // handles the socket its own way, from losing the 413 to what the adapter does with the body
    for (const mode of ['optimized', 'native'] as const) {
      it(`${mode} mode: a client uploading the body gets the 413, every time`, async () => {
        const port = nextPort++
        server = await serve({ port, mode, maxBodySize: 1000, fetch: () => new Response('ok') })
        const size = 64_000_000
        const chunk = Buffer.alloc(65_536, 97)
        for (let attempt = 1; attempt <= 10; attempt++) {
          const socket = net.connect(port, '127.0.0.1')
          await once(socket, 'connect')
          let received = ''
          let closed = false
          socket.setEncoding('latin1')
          socket.on('data', (data: string) => {
            received += data
          })
          socket.on('error', () => {})
          socket.on('close', () => {
            closed = true
          })
          socket.write(`POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${size}\r\n\r\n`)
          for (let sent = 0; sent < size && socket.writable; sent += chunk.length) {
            if (!socket.write(chunk.subarray(0, size - sent))) {
              await new Promise((resolve) => {
                socket.once('drain', resolve)
                socket.once('close', resolve)
              })
            }
          }
          const started = Date.now()
          while (!received.includes('"message":"Payload Too Large"}') && !closed && Date.now() - started < 3000) {
            await new Promise((resolve) => setTimeout(resolve, 5))
          }
          socket.destroy()
          expect(received).toMatch(/^HTTP\/1\.1 413 /)
        }
      }, 30_000)
    }

    it('should error chunked bodies past the cap with PayloadTooLargeError', async () => {
      const port = nextPort++
      server = await serve({
        port,
        maxBodySize: 100,
        fetch: async (req) => {
          try {
            await req.text()
            return new Response('should not get here', { status: 500 })
          } catch (e) {
            return new Response((e as Error).name, { status: 413 })
          }
        },
      })

      const res = await chunkedRequest(`http://localhost:${port}/upload`, ['x'.repeat(250), 'x'.repeat(250)])
      expect(res.status).toBe(413)
      expect(res.body).toBe('PayloadTooLargeError')
    })

    it('should deliver chunked bodies under the cap intact', async () => {
      const port = nextPort++
      server = await serve({
        port,
        maxBodySize: 1000,
        fetch: async (req) => new Response(await req.text()),
      })

      const res = await chunkedRequest(`http://localhost:${port}/upload`, ['y'.repeat(250), 'y'.repeat(250)])
      expect(res.status).toBe(200)
      expect(res.body).toBe('y'.repeat(500))
    })

    it('should accept large bodies when maxBodySize is false', async () => {
      const port = nextPort++
      server = await serve({
        port,
        maxBodySize: false,
        fetch: async (req) => {
          const text = await req.text()
          return new Response(String(text.length))
        },
      })

      const payload = 'z'.repeat(2 * 1024 * 1024)
      const res = await request(`http://localhost:${port}/upload`, {
        method: 'POST',
        body: payload,
        headers: { 'content-length': String(payload.length) },
      })
      expect(res.status).toBe(200)
      expect(res.body).toBe(String(2 * 1024 * 1024))
    })

    it('should apply the 1MB default when the option is omitted', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => new Response('ok'),
      })

      const res = await request(`http://localhost:${port}/upload`, {
        method: 'POST',
        body: 'x'.repeat(2_000_000),
        headers: { 'content-length': '2000000' },
      })
      expect(res.status).toBe(413)
    })

    it('should reject oversized Content-Length in native mode', async () => {
      const port = nextPort++
      let handlerCalled = false
      server = await serve({
        port,
        mode: 'native',
        maxBodySize: 1000,
        fetch: () => {
          handlerCalled = true
          return new Response('ok')
        },
      })

      const res = await request(`http://localhost:${port}/upload`, {
        method: 'POST',
        body: 'x'.repeat(5000),
        headers: { 'content-length': '5000' },
      })
      expect(res.status).toBe(413)
      expect(handlerCalled).toBe(false)
    })

    it('should error chunked bodies past the cap in native mode', async () => {
      const port = nextPort++
      server = await serve({
        port,
        mode: 'native',
        maxBodySize: 100,
        fetch: async (req) => {
          try {
            await req.text()
            return new Response('should not get here', { status: 500 })
          } catch (e) {
            return new Response((e as Error).name, { status: 413 })
          }
        },
      })

      const res = await chunkedRequest(`http://localhost:${port}/upload`, ['x'.repeat(250), 'x'.repeat(250)])
      expect(res.status).toBe(413)
      expect(res.body).toBe('PayloadTooLargeError')
    })

    it('should keep the buffer fast path working with the option set', async () => {
      const port = nextPort++
      server = await serve({
        port,
        maxBodySize: 1000,
        fetch: async (req) => {
          const body = await req.json()
          return new Response(JSON.stringify(body))
        },
      })

      const payload = JSON.stringify({ name: 'test' })
      const res = await request(`http://localhost:${port}/data`, {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json', 'content-length': String(payload.length) },
      })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ name: 'test' })
    })
  })

  // ── Connection info ───────────────────────────────────────

  describe('connection info', () => {
    const loopbacks = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

    it('should expose _conn on the request proxy (optimized mode)', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: (req) => new Response(JSON.stringify((req as any)._conn)),
      })

      const res = await request(`http://localhost:${port}/`)
      expect(res.status).toBe(200)
      const conn = JSON.parse(res.body)
      expect(loopbacks).toContain(conn.remoteAddress)
      expect(typeof conn.remotePort).toBe('number')
      expect(['IPv4', 'IPv6']).toContain(conn.family)
    })

    it('should expose _conn on the request (native mode)', async () => {
      const port = nextPort++
      server = await serve({
        port,
        mode: 'native',
        fetch: (req) => new Response(JSON.stringify((req as any)._conn)),
      })

      const res = await request(`http://localhost:${port}/`)
      expect(res.status).toBe(200)
      const conn = JSON.parse(res.body)
      expect(loopbacks).toContain(conn.remoteAddress)
      expect(typeof conn.remotePort).toBe('number')
      expect(['IPv4', 'IPv6']).toContain(conn.family)
    })
  })
})
