import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import * as net from 'node:net'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { type ServerHandle, serve } from '../dist/index.js'

// Runs on Node (`bun run test:node-server`): when node:http lets a socket go, and what a reset under an upload does
// to the answer, is Node's own - Bun's node:http does neither the same way, so `bun run test` leaves this file out.

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

async function start(mode: 'optimized' | 'native'): Promise<{ handle: ServerHandle; port: number }> {
  const port = await freePort()
  const handle = await serve({ port, hostname: '127.0.0.1', mode, maxBodySize: 1000, fetch: () => new Response('ok') })
  handles.add(handle)
  return { handle, port }
}

/** `promise`, or a rejection after `ms`: a connection that is never let go fails the test instead of holding it. */
async function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function head(length: number, extra = ''): string {
  return `POST /upload HTTP/1.1\r\nHost: localhost\r\n${extra}Content-Length: ${length}\r\n\r\n`
}

const UPLOAD = 64_000_000

/** Collects what the connection answers, and waits for it to say something or end. */
function listen(socket: net.Socket): { received: () => string; until: (pattern: RegExp, ms: number) => Promise<void> } {
  let received = ''
  let closed = false
  socket.setEncoding('latin1')
  socket.on('data', (chunk: string) => {
    received += chunk
  })
  socket.on('error', () => {})
  socket.on('close', () => {
    closed = true
  })
  return {
    received: () => received,
    async until(pattern, ms) {
      const started = Date.now()
      while (!pattern.test(received) && !closed && Date.now() - started < ms) await sleep(5)
    },
  }
}

/** Writes a declared body flat out, as an upload does, and returns the answer once it is there or the connection ended. */
async function upload(port: number): Promise<string> {
  const socket = net.connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const conn = listen(socket)
  socket.write(head(UPLOAD))
  const chunk = Buffer.alloc(65_536, 97)
  for (let sent = 0; sent < UPLOAD && socket.writable; sent += chunk.length) {
    if (!socket.write(chunk.subarray(0, UPLOAD - sent))) {
      await Promise.race([
        new Promise((resolve) => socket.once('drain', resolve)),
        new Promise((resolve) => socket.once('close', resolve)),
      ])
    }
  }
  await conn.until(/"message":"Payload Too Large"\}/, 3000)
  socket.destroy()
  return conn.received()
}

/** A client that never closes its side: only the server can end the connection. */
async function halfOpen(port: number, request: string): Promise<{ socket: net.Socket; received: () => string }> {
  const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true })
  await once(socket, 'connect')
  const conn = listen(socket)
  socket.write(request)
  await conn.until(/"message":"Payload Too Large"\}/, 2000)
  assert.match(conn.received(), /HTTP\/1\.1 413 /, 'no 413')
  return { socket, received: conn.received }
}

for (const mode of ['optimized', 'native'] as const) {
  describe(`${mode} mode: a declared Content-Length over maxBodySize`, () => {
    it('gets the 413 to a client uploading the body, every time', { timeout: 30000 }, async () => {
      const { port } = await start(mode)
      // Destroyed with the upload still unread, the connection was reset and the 413 lost about every other time
      for (let attempt = 1; attempt <= 10; attempt++) {
        assert.match(await upload(port), /^HTTP\/1\.1 413 /, `attempt ${attempt}: the 413 was lost`)
      }
    })

    it('gets the 413 to fetch() uploads, every time', { timeout: 30000 }, async () => {
      const { port } = await start(mode)
      const body = new Uint8Array(UPLOAD)
      for (let attempt = 1; attempt <= 10; attempt++) {
        const status = await fetch(`http://127.0.0.1:${port}/upload`, { method: 'POST', body }).then(
          (res) => res.status,
          (error: Error & { cause?: { code?: string } }) => error.cause?.code ?? error.message,
        )
        assert.equal(status, 413, `attempt ${attempt}`)
      }
    })

    it('keeps the connection for the next request once the body is through', { timeout: 5000 }, async () => {
      const { port } = await start(mode)
      const socket = net.connect(port, '127.0.0.1')
      await once(socket, 'connect')
      const conn = listen(socket)
      try {
        socket.write(head(5000) + 'a'.repeat(5000))
        await conn.until(/"message":"Payload Too Large"\}/, 2000)
        assert.match(conn.received(), /^HTTP\/1\.1 413 /)
        assert.doesNotMatch(conn.received(), /\r\nconnection: close\r\n/i)
        socket.write('GET /next HTTP/1.1\r\nHost: localhost\r\n\r\n')
        await conn.until(/HTTP\/1\.1 200 /, 2000)
        assert.match(conn.received(), /HTTP\/1\.1 200 /, 'no answer to the next request')
      } finally {
        socket.destroy()
      }
    })

    it('lets go of a client that sends no body after the drain', { timeout: 5000 }, async () => {
      const { port } = await start(mode)
      const { socket } = await halfOpen(port, head(5_000_000))
      let failed: Error | null = null
      socket.on('error', (error) => {
        failed = error
      })
      // A write meets a closed connection once the server has let it go, after its drain of 500 ms
      for (let i = 0; i < 20 && !failed; i++) {
        await sleep(100)
        socket.write('x')
      }
      socket.destroy()
      assert.ok(failed, 'the server still held the connection 2 s after the 413')
    })

    it('answers Expect: 100-continue with 100 Continue and then the 413', { timeout: 5000 }, async () => {
      const { port } = await start(mode)
      const { socket, received } = await halfOpen(port, head(5_000_000, 'Expect: 100-continue\r\n'))
      socket.destroy()
      assert.match(received(), /^HTTP\/1\.1 100 Continue\r\n\r\nHTTP\/1\.1 413 /)
    })

    it('close() waits for a connection draining a refused body no longer than the drain', {
      timeout: 5000,
    }, async () => {
      const { handle, port } = await start(mode)
      handles.delete(handle)
      const { socket } = await halfOpen(port, head(5_000_000))
      try {
        await within(handle.close(), 1500, 'close() waited past the drain')
      } finally {
        socket.destroy()
      }
    })
  })
}
