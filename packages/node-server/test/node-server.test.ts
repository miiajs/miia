import { afterEach, describe, expect, it } from 'bun:test'
import * as http from 'node:http'
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
      })
      expect(res.status).toBe(413)
      expect(JSON.parse(res.body)).toEqual({
        statusCode: 413,
        error: 'Payload Too Large',
        message: 'Payload Too Large',
      })
      expect(handlerCalled).toBe(false)
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
})
