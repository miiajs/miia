import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import * as net from 'node:net'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { Miia } from '@miiajs/core'
import { type ServeOptions, type ServerHandle, serve } from '../dist/index.js'

// Runs on Node (`bun run test:node-server`): what a cancel of the request body does to the socket and to the process
// is Node's own. An uncaught exception from a cancel fails the test it happens in.

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

type Mode = 'optimized' | 'native'

async function start(
  mode: Mode,
  fetch: ServeOptions['fetch'],
  options: Partial<ServeOptions> = {},
): Promise<{ port: number }> {
  const port = await freePort()
  const handle = await serve({ port, hostname: '127.0.0.1', mode, logger: { error() {} }, fetch, ...options })
  handles.add(handle)
  return { port }
}

/** Collects what the connection answers, and waits for it to say something or end. */
function listen(socket: net.Socket): {
  received: () => string
  closed: () => boolean
  until: (pattern: RegExp, ms: number) => Promise<boolean>
} {
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
    closed: () => closed,
    async until(pattern, ms) {
      const started = Date.now()
      while (!pattern.test(received) && !closed && Date.now() - started < ms) await sleep(5)
      return pattern.test(received)
    },
  }
}

async function connect(port: number): Promise<{ socket: net.Socket; conn: ReturnType<typeof listen> }> {
  const socket = net.connect(port, '127.0.0.1')
  await once(socket, 'connect')
  return { socket, conn: listen(socket) }
}

const SIZE = 1_000_000

type Framing = 'declared length' | 'chunked' | 'chunked, no cap'

const FRAMINGS: { framing: Framing; maxBodySize: number | false }[] = [
  { framing: 'declared length', maxBodySize: 10_000_000 },
  { framing: 'chunked', maxBodySize: 10_000_000 }, // through the in-stream cap
  { framing: 'chunked, no cap', maxBodySize: false },
]

function head(framing: Framing): string {
  const length = framing === 'declared length' ? `Content-Length: ${SIZE}` : 'Transfer-Encoding: chunked'
  return `POST /upload HTTP/1.1\r\nHost: localhost\r\n${length}\r\n\r\n`
}

/** A whole request in one write, so its body is buffered in the request by the time the handler goes on. */
function wholeRequest(framing: Framing): string {
  const body = 'a'.repeat(SIZE)
  return head(framing) + (framing === 'declared length' ? body : `${SIZE.toString(16)}\r\n${body}\r\n0\r\n\r\n`)
}

type BodyHandler = (body: ReadableStream<Uint8Array>) => Promise<unknown>

const CANCELS: Record<string, BodyHandler> = {
  'body.cancel()': (body) => body.cancel(),
  'body.cancel() a tick later': async (body) => {
    await sleep(0)
    await body.cancel()
  },
  'a pipeThrough of the body': (body) => body.pipeThrough(new TransformStream()).cancel(),
  'a reader after its first chunk': async (body) => {
    const reader = body.getReader()
    await reader.read()
    await reader.cancel()
  },
}

function cancelling(cancel: BodyHandler, after: () => Promise<unknown> = async () => {}): ServeOptions['fetch'] {
  return async (req) => {
    if (req.method === 'GET') return new Response('next')
    await cancel(req.body!)
    await after()
    return new Response('cancelled')
  }
}

for (const mode of ['optimized', 'native'] as const) {
  describe(`${mode} mode: a handler that cancels the request body`, () => {
    for (const { framing, maxBodySize } of FRAMINGS) {
      for (const [name, cancel] of Object.entries(CANCELS)) {
        it(`${name}, ${framing}: answers, and answers the next request on the connection`, {
          timeout: 5000,
        }, async () => {
          const { port } = await start(mode, cancelling(cancel), { maxBodySize })
          const { socket, conn } = await connect(port)
          try {
            socket.write(wholeRequest(framing))
            assert.ok(await conn.until(/cancelled/, 2000), `no answer: ${conn.received().slice(0, 200)}`)
            assert.match(conn.received(), /^HTTP\/1\.1 200 /)
            // Whatever is left of the body goes first, so the connection can carry the next request
            assert.doesNotMatch(conn.received(), /\r\nconnection: close\r\n/i)
            socket.write('GET /next HTTP/1.1\r\nHost: localhost\r\n\r\n')
            assert.ok(await conn.until(/next/, 2000), 'no answer to the next request')
          } finally {
            socket.destroy()
          }
        })
      }
    }

    it('gets the response to a client uploading flat out, every time', { timeout: 30000 }, async () => {
      const { port } = await start(mode, cancelling(CANCELS['a pipeThrough of the body']), {
        maxBodySize: false,
      })
      const size = 64_000_000
      const chunk = Buffer.alloc(65_536, 97)
      for (let attempt = 1; attempt <= 10; attempt++) {
        const { socket, conn } = await connect(port)
        socket.write(`POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${size}\r\n\r\n`)
        // On to the end whatever comes back: a connection closed with the upload unread resets, and takes the answer along
        for (let sent = 0; sent < size && socket.writable; sent += chunk.length) {
          if (!socket.write(chunk)) {
            await Promise.race([
              new Promise((resolve) => socket.once('drain', resolve)),
              new Promise((resolve) => socket.once('close', resolve)),
            ])
          }
        }
        assert.ok(await conn.until(/cancelled/, 3000), `attempt ${attempt}: the response was lost`)
        socket.destroy()
      }
      const next = await fetch(`http://127.0.0.1:${port}/next`)
      assert.equal(await next.text(), 'next')
    })

    it('reads no more of the upload while the handler is still at work', { timeout: 5000 }, async () => {
      const { port } = await start(
        mode,
        cancelling(CANCELS['a pipeThrough of the body'], () => sleep(300)),
        { maxBodySize: false },
      )
      const size = 64_000_000
      const chunk = Buffer.alloc(65_536, 97)
      const { socket, conn } = await connect(port)
      try {
        socket.write(`POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${size}\r\n\r\n`)
        let sent = 0
        while (sent < size && socket.writable && !conn.received()) {
          sent += chunk.length
          if (!socket.write(chunk)) {
            await Promise.race([new Promise((resolve) => socket.once('drain', resolve)), conn.until(/cancelled/, 2000)])
          }
        }
        assert.ok(await conn.until(/cancelled/, 2000), 'no answer')
        assert.ok(sent < size, 'the whole upload went through before the response')
      } finally {
        socket.destroy()
      }
    })

    for (const { framing, maxBodySize } of FRAMINGS) {
      it(`${framing}: a response later than the drain timeout still gets out`, { timeout: 5000 }, async () => {
        const { port } = await start(
          mode,
          cancelling(CANCELS['a pipeThrough of the body'], () => sleep(800)),
          { maxBodySize },
        )
        const { socket, conn } = await connect(port)
        try {
          // A client that stops half way: nothing but the server's drain can end this connection
          socket.write(head(framing))
          const half = 'a'.repeat(SIZE / 2)
          socket.write(framing === 'declared length' ? half : `${half.length.toString(16)}\r\n${half}\r\n`)
          assert.ok(await conn.until(/cancelled/, 2000), 'the response did not get out')
        } finally {
          socket.destroy()
        }
      })

      it(`${framing}: a client that stops sending is let go after the drain`, { timeout: 5000 }, async () => {
        const { port } = await start(mode, cancelling(CANCELS['a pipeThrough of the body']), { maxBodySize })
        const { socket, conn } = await connect(port)
        socket.write(head(framing))
        const half = 'a'.repeat(SIZE / 2)
        socket.write(framing === 'declared length' ? half : `${half.length.toString(16)}\r\n${half}\r\n`)
        assert.ok(await conn.until(/cancelled/, 2000), 'no answer')
        const started = Date.now()
        while (!conn.closed() && Date.now() - started < 2000) await sleep(10)
        const closed = conn.closed()
        socket.destroy()
        assert.ok(closed, 'the server still held the connection 2 s after the response')
      })
    }

    it('a handler that throws after the cancel gets its 500 out, and the connection is reused', {
      timeout: 5000,
    }, async () => {
      const { port } = await start(mode, async (req) => {
        if (req.method === 'GET') return new Response('next')
        await req.body!.pipeThrough(new TransformStream()).cancel()
        throw new Error('boom')
      })
      const { socket, conn } = await connect(port)
      try {
        socket.write(wholeRequest('declared length'))
        assert.ok(await conn.until(/Internal Server Error"}/, 2000), `no 500: ${conn.received().slice(0, 200)}`)
        assert.match(conn.received(), /^HTTP\/1\.1 500 /)
        socket.write('GET /next HTTP/1.1\r\nHost: localhost\r\n\r\n')
        assert.ok(await conn.until(/next/, 2000), 'no answer to the next request')
      } finally {
        socket.destroy()
      }
    })

    it('on a route of an app, through ctx.req.body', { timeout: 5000 }, async () => {
      const port = await freePort()
      const app = new Miia({ logger: false })
      app.addRoute('POST', '/upload', async (ctx) => {
        await ctx.req.body!.pipeThrough(new TransformStream()).cancel()
        return { cancelled: true }
      })
      app.addRoute('GET', '/next', () => ({ next: true }))
      await app.listen(port, '127.0.0.1', (options) => serve({ ...options, mode }))
      try {
        const { socket, conn } = await connect(port)
        try {
          socket.write(`POST /upload HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n`)
          const part = 'a'.repeat(200_000)
          socket.write(`${part.length.toString(16)}\r\n${part}\r\n`.repeat(2))
          socket.write('0\r\n\r\n')
          assert.ok(await conn.until(/"cancelled":true/, 2000), `no answer: ${conn.received().slice(0, 200)}`)
          socket.write('GET /next HTTP/1.1\r\nHost: localhost\r\n\r\n')
          assert.ok(await conn.until(/"next":true/, 2000), 'no answer to the next request')
        } finally {
          socket.destroy()
        }
      } finally {
        await app.destroy()
      }
    })
  })

  describe(`${mode} mode: a body read as usual`, () => {
    for (const { framing, maxBodySize } of FRAMINGS) {
      it(`${framing}: reads to the end in plain Uint8Array chunks, and the connection is reused`, {
        timeout: 5000,
      }, async () => {
        const { port } = await start(
          mode,
          async (req) => {
            if (req.method === 'GET') return new Response('next')
            let total = 0
            let plain = true
            for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) {
              total += chunk.byteLength
              plain &&= chunk instanceof Uint8Array && !Buffer.isBuffer(chunk)
            }
            return new Response(`read ${total} ${plain}`)
          },
          { maxBodySize },
        )
        const { socket, conn } = await connect(port)
        try {
          socket.write(wholeRequest(framing))
          assert.ok(await conn.until(new RegExp(`read ${SIZE} true`), 2000), conn.received().slice(0, 200))
          assert.doesNotMatch(conn.received(), /\r\nconnection: close\r\n/i)
          socket.write('GET /next HTTP/1.1\r\nHost: localhost\r\n\r\n')
          assert.ok(await conn.until(/next/, 2000), 'no answer to the next request')
        } finally {
          socket.destroy()
        }
      })

      it(`${framing}: a client gone half way rejects the read with ECONNRESET`, { timeout: 5000 }, async () => {
        let failure: (Error & { code?: string }) | undefined
        const seen = Promise.withResolvers<void>()
        const { port } = await start(
          mode,
          async (req) => {
            try {
              await req.text()
            } catch (error) {
              failure = error as Error
            }
            seen.resolve()
            return new Response('done')
          },
          { maxBodySize },
        )
        const { socket } = await connect(port)
        socket.write(head(framing))
        const half = 'a'.repeat(SIZE / 2)
        socket.write(framing === 'declared length' ? half : `${half.length.toString(16)}\r\n${half}\r\n`)
        await sleep(50)
        socket.destroy()
        await seen.promise
        assert.ok(failure, 'a truncated body read as complete')
        const cause = (failure.cause as { code?: string } | undefined)?.code
        assert.equal(failure.code ?? cause, 'ECONNRESET', String(failure))
      })
    }

    // Native mode takes the body before the handler runs and sees the failure, as above
    if (mode === 'optimized') {
      it('a body first taken after the client went reads as empty', { timeout: 5000 }, async () => {
        const seen = Promise.withResolvers<string>()
        const { port } = await start(mode, async (req) => {
          await sleep(100)
          seen.resolve(await req.text())
          return new Response('done')
        })
        const { socket } = await connect(port)
        socket.write(`POST /upload HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n`)
        await sleep(30)
        socket.destroy()
        assert.equal(await seen.promise, '')
      })
    }
  })
}
