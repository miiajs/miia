import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import { serve } from '../dist/index.js'

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

let nextPort = 19234

describe('uws-server', () => {
  let server: { close(): Promise<void> }

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
      assert.equal(res.status, 200)
      const body = JSON.parse(res.body)
      assert.equal(body.path, '/hello')
      assert.equal(body.method, 'GET')
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
      assert.equal(res.status, 200)
      const body = JSON.parse(res.body)
      assert.equal(body.foo, 'bar')
      assert.equal(body.baz, '1')
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
      assert.equal(res.body, 'http://myapp.local:9999/path')
    })
  })

  // ── POST requests - buffer path ────────────────────────────

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
      assert.equal(res.status, 200)
      const body = JSON.parse(res.body)
      assert.deepEqual(body.received, { name: 'test' })
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
      assert.equal(res.status, 200)
      assert.equal(res.body, 'hello world')
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
      assert.equal(res.status, 200)
      assert.equal(JSON.parse(res.body).empty, true)
    })
  })

  // ── POST requests - stream path ────────────────────────────

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
      assert.equal(res.status, 200)
      assert.equal(JSON.parse(res.body).text, payload)
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
      assert.equal(res.status, 200)
      assert.equal(res.body, 'chunked data')
    })
  })

  // ── HEAD requests ─────────────────────────────────────────

  describe('HEAD requests', () => {
    it('should handle HEAD request without body', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => new Response(null, { status: 200, headers: { 'X-Test': 'head' } }),
      })

      const res = await request(`http://localhost:${port}/test`, { method: 'HEAD' })
      assert.equal(res.status, 200)
      assert.equal(res.body, '')
      assert.equal(res.headers['x-test'], 'head')
    })
  })

  // ── Response types ────────────────────────────────────────

  describe('response types', () => {
    it('should send non-ASCII string bodies as UTF-8 bytes', async () => {
      const port = nextPort++
      const payload = 'привіт 🇺🇦'
      server = await serve({
        port,
        fetch: () => new Response(payload),
      })

      const res = await request(`http://localhost:${port}/utf8`)
      assert.equal(res.status, 200)
      // Byte-for-byte: the helper accumulates Buffer chunks decoded as UTF-8,
      // so any Latin-1 mis-encoding on the wire breaks this equality.
      assert.equal(res.body, payload)
    })

    it('should return custom status code and headers', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () =>
          new Response('created', {
            status: 201,
            headers: { 'X-Custom': 'value', 'Content-Type': 'text/plain' },
          }),
      })

      const res = await request(`http://localhost:${port}/test`)
      assert.equal(res.status, 201)
      assert.equal(res.headers['x-custom'], 'value')
      assert.equal(res.body, 'created')
    })

    it('should return null body with 204 status', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => new Response(null, { status: 204 }),
      })

      const res = await request(`http://localhost:${port}/no-content`)
      assert.equal(res.status, 204)
      assert.equal(res.body, '')
    })

    it('should return Uint8Array body', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => new Response(new Uint8Array([72, 101, 108, 108, 111])),
      })

      const res = await request(`http://localhost:${port}/binary`)
      assert.equal(res.status, 200)
      assert.equal(res.body, 'Hello')
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
      assert.equal(res.status, 200)
      assert.equal(res.body, 'chunk1chunk2chunk3')
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
      assert.equal(res.status, 200)
      const cookies = res.headers['set-cookie']
      assert.ok(Array.isArray(cookies))
      assert.ok(cookies.includes('a=1'))
      assert.ok(cookies.includes('b=2'))
    })
  })

  // ── LightResponse static methods ──────────────────────────

  describe('LightResponse static methods', () => {
    it('should handle Response.json() with correct content-type', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => Response.json({ ok: true }),
      })

      const res = await request(`http://localhost:${port}/json`)
      assert.equal(res.status, 200)
      assert.deepEqual(JSON.parse(res.body), { ok: true })
      assert.equal(res.headers['content-type'], 'application/json')
    })

    it('should handle Response.redirect()', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => Response.redirect('/new-location'),
      })

      // Use raw http.request to prevent auto-follow redirects
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
      assert.equal(res.status, 302)
      assert.equal(res.headers['location'], '/new-location')
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
      assert.equal(body.lower, 'test-value')
      assert.equal(body.upper, 'test-value')
      assert.equal(body.mixed, 'test-value')
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
      assert.ok(body.accept.includes('text/html'))
      assert.ok(body.accept.includes('application/json'))
    })
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
      assert.equal(body.before, false)
      assert.equal(body.after, true)
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
      assert.equal(body.text, payload)
      assert.equal(body.byteLength, Buffer.byteLength(payload))
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
      assert.equal(body.text, 'stream from body getter')
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
      assert.equal(res.status, 500)
      const body = JSON.parse(res.body)
      assert.equal(body.statusCode, 500)
      assert.equal(body.message, 'Internal Server Error')
    })

    it('should return 500 when handler returns rejected promise', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => Promise.reject(new Error('async boom')),
      })

      const res = await request(`http://localhost:${port}/error`)
      assert.equal(res.status, 500)
      const body = JSON.parse(res.body)
      assert.equal(body.statusCode, 500)
      assert.equal(body.message, 'Internal Server Error')
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
      assert.equal(res.status, 200)
      const body = JSON.parse(res.body)
      assert.equal(body.path, '/native')
      assert.equal(body.method, 'GET')
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
      assert.equal(res.status, 200)
      assert.deepEqual(JSON.parse(res.body).received, { mode: 'native' })
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
      assert.equal(res.status, 201)
      assert.equal(res.headers['x-native'], 'yes')
      assert.equal(res.body, 'ok')
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
      assert.equal(res.status, 200)
      assert.equal(JSON.parse(res.body).text, payload)
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

      assert.notEqual(globalThis.Response, Original)
      await server.close()
      assert.equal(globalThis.Response, Original)
      server = undefined as any // prevent afterEach double-close
    })
  })

  // ── maxBodySize ───────────────────────────────────────────

  describe('maxBodySize', () => {
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
        body: 'small actual body',
        headers: { 'content-length': '5000' },
      })
      assert.equal(res.status, 413)
      assert.deepEqual(JSON.parse(res.body), {
        statusCode: 413,
        error: 'Payload Too Large',
        message: 'Payload Too Large',
      })
      assert.equal(handlerCalled, false)
    })

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

      // No content-length → Node's http client sends chunked
      const res = await request(`http://localhost:${port}/upload`, {
        method: 'POST',
        body: 'x'.repeat(500),
      })
      assert.equal(res.status, 413)
      assert.equal(res.body, 'PayloadTooLargeError')
    })

    it('should deliver chunked bodies under the cap intact', async () => {
      const port = nextPort++
      server = await serve({
        port,
        maxBodySize: 1000,
        fetch: async (req) => new Response(await req.text()),
      })

      const payload = 'y'.repeat(500)
      const res = await request(`http://localhost:${port}/upload`, {
        method: 'POST',
        body: payload,
      })
      assert.equal(res.status, 200)
      assert.equal(res.body, payload)
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
      assert.equal(res.status, 200)
      assert.equal(res.body, String(2 * 1024 * 1024))
    })

    it('should apply the 1MB default when the option is omitted', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: () => new Response('ok'),
      })

      const res = await request(`http://localhost:${port}/upload`, {
        method: 'POST',
        body: 'tiny',
        headers: { 'content-length': '2000000' },
      })
      assert.equal(res.status, 413)
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
        body: 'small',
        headers: { 'content-length': '5000' },
      })
      assert.equal(res.status, 413)
      assert.equal(handlerCalled, false)
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

      const res = await request(`http://localhost:${port}/upload`, {
        method: 'POST',
        body: 'x'.repeat(500),
      })
      assert.equal(res.status, 413)
      assert.equal(res.body, 'PayloadTooLargeError')
    })
  })
})
