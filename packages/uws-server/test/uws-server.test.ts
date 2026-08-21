import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import * as http from 'node:http'
import * as net from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
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

type RawResponse = { status: number; headers: Record<string, string>; body: string; consumed: number }

/** Parses one HTTP/1.1 response (Content-Length or chunked) out of `buf`; null when incomplete. */
function parseResponse(buf: Buffer): RawResponse | null {
  const sep = buf.indexOf('\r\n\r\n')
  if (sep === -1) return null
  const lines = buf.subarray(0, sep).toString('latin1').split('\r\n')
  const status = Number(lines[0].split(' ')[1])
  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':')
    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim()
  }
  const start = sep + 4
  if (headers['transfer-encoding'] === 'chunked') {
    let offset = start
    let body = ''
    while (true) {
      const eol = buf.indexOf('\r\n', offset)
      if (eol === -1) return null
      const size = Number.parseInt(buf.subarray(offset, eol).toString('latin1'), 16)
      if (Number.isNaN(size)) throw new Error('malformed chunk size in response')
      if (buf.length < eol + 4 + size) return null
      body += buf.subarray(eol + 2, eol + 2 + size).toString()
      offset = eol + 4 + size
      if (size === 0) return { status, headers, body, consumed: offset }
    }
  }
  const length = Number(headers['content-length'] ?? 0)
  if (buf.length - start < length) return null
  return { status, headers, body: buf.subarray(start, start + length).toString(), consumed: start + length }
}

/** Raw keep-alive client - the backpressure cases need control over write pacing and framing. */
async function connectRaw(port: number) {
  const socket = net.connect(port, '127.0.0.1')
  await once(socket, 'connect')

  let buf = Buffer.alloc(0)
  let failure: Error | null = null
  let notify: (() => void) | null = null
  const wake = () => notify?.()

  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    wake()
  })
  socket.on('error', (err: Error) => {
    failure ??= err
    wake()
  })
  socket.on('close', () => {
    failure ??= new Error('socket closed before a full response')
    wake()
  })

  const readResponse = async (): Promise<RawResponse> => {
    while (true) {
      const parsed = parseResponse(buf)
      if (parsed) {
        buf = buf.subarray(parsed.consumed)
        return parsed
      }
      if (failure) throw failure
      await new Promise<void>((resolve) => {
        notify = () => {
          notify = null
          resolve()
        }
      })
    }
  }

  return { socket, readResponse }
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

  // ── Connection info ───────────────────────────────────────

  describe('connection info', () => {
    // uWS reports remote addresses in expanded form: dotted-quad for IPv4,
    // and either full IPv6 (`0000:...:0001`) or IPv4-mapped (`...ffff:7f00:0001`)
    // for loopback over a dual-stack listener. Accept all of them, and just
    // assert family is consistent with the presence of ':' in the address.
    const looksLikeLoopback = (addr: string) =>
      typeof addr === 'string' && (addr === '127.0.0.1' || addr.includes(':') || /\.\d+$/.test(addr))

    it('should expose _conn in optimized mode', async () => {
      const port = nextPort++
      server = await serve({
        port,
        fetch: (req) => Response.json((req as any)._conn),
      })

      const res = await request(`http://localhost:${port}/conn`)
      assert.equal(res.status, 200)
      const conn = JSON.parse(res.body)
      assert.ok(looksLikeLoopback(conn.remoteAddress), `unexpected remoteAddress: ${conn.remoteAddress}`)
      assert.equal(conn.family, conn.remoteAddress.includes(':') ? 'IPv6' : 'IPv4')
      assert.ok(typeof conn.remotePort === 'number' && conn.remotePort > 0, `unexpected remotePort: ${conn.remotePort}`)
    })

    it('should expose _conn in native mode', async () => {
      const port = nextPort++
      server = await serve({
        port,
        mode: 'native',
        fetch: (req) => Response.json((req as any)._conn),
      })

      const res = await request(`http://localhost:${port}/conn`)
      assert.equal(res.status, 200)
      const conn = JSON.parse(res.body)
      assert.ok(looksLikeLoopback(conn.remoteAddress), `unexpected remoteAddress: ${conn.remoteAddress}`)
      assert.equal(conn.family, conn.remoteAddress.includes(':') ? 'IPv6' : 'IPv4')
      assert.ok(typeof conn.remotePort === 'number' && conn.remotePort > 0, `unexpected remotePort: ${conn.remotePort}`)
    })
  })

  // ── Body backpressure ─────────────────────────────────────
  //
  // Every case takes an explicit timeout and destroys its socket in a finally:
  // node:test defaults to no timeout and a wedged connection yields no response
  // at all, so a regression would hang the run instead of failing it.

  describe('body backpressure', () => {
    it('should throttle the socket to the consumer pace', { timeout: 5000 }, async () => {
      const port = nextPort++
      let release = () => {}
      const stall = new Promise<void>((resolve) => {
        release = resolve
      })
      server = await serve({
        port,
        maxBodySize: false,
        fetch: async (req) => {
          const reader = req.body!.getReader()
          await reader.read()
          await stall
          return new Response('done')
        },
      })

      const { socket } = await connectRaw(port)
      try {
        socket.write('POST /slow HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n')

        const frame = Buffer.from(`10000\r\n${'x'.repeat(0x10000)}\r\n`)
        const total = frame.length * 512 // ~32MB
        let queued = 0
        let stalled = false
        const deadline = Date.now() + 1500
        while (queued < total && Date.now() < deadline) {
          const flushed = socket.write(frame)
          queued += frame.length
          if (!flushed) {
            stalled = true
            const drained = await Promise.race([
              once(socket, 'drain').then(
                () => true,
                () => false,
              ),
              sleep(250, false),
            ])
            if (!drained) break
          }
        }

        const accepted = queued - socket.writableLength
        assert.ok(stalled, 'the write loop never stalled - the socket swallowed the whole body')
        assert.ok(accepted < total / 2, `expected an early stall, the socket accepted ${accepted} of ${total} bytes`)
      } finally {
        release()
        socket.destroy()
      }
    })

    it('should finish a paused body and keep the connection usable', { timeout: 5000 }, async () => {
      const port = nextPort++
      server = await serve({
        port,
        bodyHighWaterMark: 4096,
        maxBodySize: false,
        fetch: async (req) => {
          if (!req.body) return new Response('second')
          const reader = req.body.getReader()
          let received = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            received += value.byteLength
          }
          return new Response(String(received))
        },
      })

      const { socket, readResponse } = await connectRaw(port)
      try {
        // One write: completion-while-paused must not depend on read-buffer luck
        socket.write(
          'POST /paused HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n' +
            `1000\r\n${'z'.repeat(4096)}\r\n`.repeat(3) +
            '0\r\n\r\n',
        )
        const first = await readResponse()
        assert.equal(first.status, 200)
        assert.equal(first.body, String(4096 * 3))

        socket.write('GET /again HTTP/1.1\r\nHost: localhost\r\n\r\n')
        const second = await readResponse()
        assert.equal(second.status, 200)
        assert.equal(second.body, 'second')
      } finally {
        socket.destroy()
      }
    })

    it('should not throw when the response ends before the pause threshold', { timeout: 5000 }, async () => {
      const port = nextPort++
      server = await serve({
        port,
        bodyHighWaterMark: 4096,
        maxBodySize: false,
        fetch: () => new Response('ignored'),
      })

      const { socket, readResponse } = await connectRaw(port)
      let uploading = true
      let pump: Promise<void> = Promise.resolve()
      try {
        socket.write('POST /ignored HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n')
        const frame = Buffer.from(`10000\r\n${'q'.repeat(0x10000)}\r\n`)
        pump = (async () => {
          while (uploading) {
            if (socket.write(frame)) await sleep(0)
            else
              await Promise.race([
                once(socket, 'drain').then(
                  () => true,
                  () => false,
                ),
                sleep(50, false),
              ])
          }
        })()

        const res = await readResponse()
        assert.equal(res.status, 200)
        assert.equal(res.body, 'ignored')
        await sleep(200) // let onData fire again after the response ended
      } finally {
        uploading = false
        await pump.catch(() => {})
        socket.destroy()
      }
    })

    it('should deliver the response while the client is still uploading', { timeout: 5000 }, async () => {
      const port = nextPort++
      server = await serve({ port, maxBodySize: false, fetch: () => new Response('early') })

      const { socket, readResponse } = await connectRaw(port)
      let uploading = true
      let responded = false
      let acceptedAfterResponse = 0
      let pump: Promise<void> = Promise.resolve()
      try {
        socket.write('POST /early HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n')
        const frame = Buffer.from(`10000\r\n${'w'.repeat(0x10000)}\r\n`)
        pump = (async () => {
          while (uploading) {
            const flushed = socket.write(frame)
            if (flushed && responded) acceptedAfterResponse += frame.length
            if (flushed) await sleep(0)
            else
              await Promise.race([
                once(socket, 'drain').then(
                  () => true,
                  () => false,
                ),
                sleep(50, false),
              ])
          }
        })()

        const res = await readResponse()
        responded = true
        assert.equal(res.status, 200)
        assert.equal(res.body, 'early')
        await sleep(200)
        assert.ok(acceptedAfterResponse > 0, 'the client could not upload any further once the response was out')
      } finally {
        uploading = false
        await pump.catch(() => {})
        socket.destroy()
      }
    })

    it('should keep the connection reusable after an unread body', { timeout: 5000 }, async () => {
      const port = nextPort++
      server = await serve({
        port,
        maxBodySize: false,
        fetch: (req) => new Response(req.method === 'GET' ? 'second' : 'first'),
      })

      const { socket, readResponse } = await connectRaw(port)
      try {
        socket.write('POST /ignored HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n')
        socket.write(`10000\r\n${'v'.repeat(0x10000)}\r\n`)
        const first = await readResponse()
        assert.equal(first.status, 200)
        assert.equal(first.body, 'first')

        // Terminate the first body, otherwise the follow-up is eaten as body data
        socket.write('0\r\n\r\n')
        socket.write('GET /again HTTP/1.1\r\nHost: localhost\r\n\r\n')
        const second = await readResponse()
        assert.equal(second.status, 200)
        assert.equal(second.body, 'second')
      } finally {
        socket.destroy()
      }
    })

    it('should deliver a limit error raised while paused', { timeout: 5000 }, async () => {
      const port = nextPort++
      server = await serve({
        port,
        bodyHighWaterMark: 4096,
        maxBodySize: 6000,
        fetch: async (req) => {
          if (!req.body) return new Response('after')
          try {
            const reader = req.body.getReader()
            while (!(await reader.read()).done) {
              /* drain */
            }
            return new Response('should not get here', { status: 500 })
          } catch (e) {
            return new Response((e as Error).name, { status: 413 })
          }
        },
      })

      const { socket, readResponse } = await connectRaw(port)
      try {
        // Pause on piece 1, pieces 2-3 arrive paused and cross the cap
        socket.write(
          'POST /capped HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n' +
            `1000\r\n${'p'.repeat(4096)}\r\n`.repeat(3) +
            '0\r\n\r\n',
        )
        const first = await readResponse()
        assert.equal(first.status, 413)
        assert.equal(first.body, 'PayloadTooLargeError')

        socket.write('GET /after HTTP/1.1\r\nHost: localhost\r\n\r\n')
        const second = await readResponse()
        assert.equal(second.status, 200)
        assert.equal(second.body, 'after')
      } finally {
        socket.destroy()
      }
    })

    it('should stream a response while the request body goes unread', { timeout: 5000 }, async () => {
      const port = nextPort++
      server = await serve({
        port,
        bodyHighWaterMark: 4096,
        maxBodySize: false,
        fetch: () => {
          const encoder = new TextEncoder()
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('part1'))
              controller.enqueue(encoder.encode('part2'))
              controller.close()
            },
          })
          return new Response(stream, { headers: { 'Content-Type': 'text/plain' } })
        },
      })

      const { socket, readResponse } = await connectRaw(port)
      try {
        socket.write(
          'POST /streamed HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n' +
            `2000\r\n${'s'.repeat(0x2000)}\r\n`,
        )
        const res = await readResponse()
        assert.equal(res.status, 200)
        assert.equal(res.body, 'part1part2')
      } finally {
        socket.destroy()
      }
    })

    it('should reject an invalid bodyHighWaterMark', { timeout: 5000 }, async () => {
      await assert.rejects(() => serve({ port: nextPort++, bodyHighWaterMark: 0, fetch: () => new Response('ok') }), {
        name: 'TypeError',
        message: /bodyHighWaterMark/,
      })
      await assert.rejects(() => serve({ port: nextPort++, bodyHighWaterMark: 1.5, fetch: () => new Response('ok') }), {
        name: 'TypeError',
        message: /bodyHighWaterMark/,
      })
    })
  })
})
