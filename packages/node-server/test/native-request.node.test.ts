import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import * as net from 'node:net'
import type { AddressInfo } from 'node:net'
import { Miia } from '@miiajs/core'
import { type ServerHandle, serve } from '../dist/index.js'

// Runs on Node (`bun run test:node-server`): the Request that native mode builds is Node's own, which refuses a TRACE
// that Bun's builds, and the Host it is built on comes from Node's parser.

const handles = new Set<ServerHandle>()

afterEach(async () => {
  const open = [...handles]
  handles.clear()
  await Promise.all(open.map((handle) => handle.close()))
})

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })
}

async function start(
  mode: 'optimized' | 'native',
  fetch: (req: Request) => Response | Promise<Response>,
): Promise<{ port: number }> {
  const port = await freePort()
  const handle = await serve({ port, hostname: '127.0.0.1', mode, logger: { error() {} }, fetch })
  handles.add(handle)
  return { port }
}

/** Sends `head` (and `body`) on a connection of its own and reads the answer to the close. */
async function exchange(port: number, head: string, body = ''): Promise<{ status: number; body: string }> {
  const socket = net.connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const chunks: Buffer[] = []
  socket.on('data', (chunk: Buffer) => chunks.push(chunk))
  socket.on('error', () => {})
  const closed = once(socket, 'close')
  socket.write(`${head}Connection: close\r\n\r\n${body}`)
  await closed
  const text = Buffer.concat(chunks).toString()
  const end = text.indexOf('\r\n\r\n')
  const status = Number(text.split(' ')[1])
  let rest = text.slice(end + 4)
  if (!/\r\ntransfer-encoding: chunked/i.test(text.slice(0, end))) return { status, body: rest }
  // Native mode streams a body without a declared length chunked
  let decoded = ''
  for (let size = Number.parseInt(rest, 16); size > 0; size = Number.parseInt(rest, 16)) {
    const start = rest.indexOf('\r\n') + 2
    decoded += rest.slice(start, start + size)
    rest = rest.slice(start + size + 2)
  }
  return { status, body: decoded }
}

describe('a method a Request cannot carry', () => {
  it('gets a 501 in native mode instead of a 500, and the server carries on', async () => {
    let reached = false
    const { port } = await start('native', () => {
      reached = true
      return new Response('ok', { headers: { 'content-length': '2' } })
    })

    for (const body of ['', 'hello']) {
      const head = `TRACE / HTTP/1.1\r\nHost: localhost\r\n${body ? `Content-Length: ${body.length}\r\n` : ''}`
      const res = await exchange(port, head, body)
      assert.equal(res.status, 501)
      assert.deepEqual(JSON.parse(res.body), { statusCode: 501, error: 'Not Implemented', message: 'Not Implemented' })
    }
    assert.equal(reached, false)
    assert.equal((await exchange(port, 'GET / HTTP/1.1\r\nHost: localhost\r\n')).status, 200)
  })

  it('reaches the app in optimized mode, as on Bun and Deno', async () => {
    const { port } = await start('optimized', (req) => new Response(req.method))
    const res = await exchange(port, 'TRACE / HTTP/1.1\r\nHost: localhost\r\n')
    assert.equal(res.status, 200)
    assert.equal(res.body, 'TRACE')
  })
})

describe('a Host header with more than a host in it', () => {
  // An empty one too: `http:///public` parses with `public` for its host
  const hosts = ['x/admin', 'x\\admin', 'x?q=/admin', 'x#f', 'u@x', '']

  for (const mode of ['optimized', 'native'] as const) {
    it(`routes by the request target, not the Host, in ${mode} mode`, async () => {
      const app = new Miia({ logger: false })
      app.addRoute('GET', '/admin/public', () => ({ route: 'admin' }))
      app.addRoute('GET', '/public', (ctx) => ({ route: 'public', url: ctx.req.url }))
      await app.init()
      const { port } = await start(mode, app.fetch)

      for (const host of hosts) {
        const res = await exchange(port, `GET /public HTTP/1.1\r\nHost: ${host}\r\n`)
        assert.equal(res.status, 200, `Host ${host}`)
        const body = JSON.parse(res.body)
        assert.equal(body.route, 'public', `Host ${host}`)
        // Optimized mode keeps the Host in the URL as it came, as Bun and Deno do; native mode builds it on localhost,
        // or on the address the server listens on when the Host is empty
        if (mode === 'native') {
          assert.equal(body.url, host ? 'http://localhost/public' : `http://127.0.0.1:${port}/public`, `Host ${host}`)
        }
      }
    })
  }

  it('keeps a Host that is host[:port] or [IPv6]:port in native mode', async () => {
    const { port } = await start('native', (req) => new Response(req.url))
    const cases = [
      ['example.com:8080', 'http://example.com:8080/p?q=1'],
      ['EXAMPLE.com', 'http://example.com/p?q=1'],
      ['[::1]:8080', 'http://[::1]:8080/p?q=1'],
    ]
    for (const [host, url] of cases) {
      const res = await exchange(port, `GET /p?q=1 HTTP/1.1\r\nHost: ${host}\r\n`)
      assert.equal(res.body, url, `Host ${host}`)
    }
  })
})
