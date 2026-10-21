import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import * as http from 'node:http'
import * as net from 'node:net'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import type { LoggerService } from '@miiajs/core'
import { Miia } from '@miiajs/core'
import { serve } from '../dist/index.js'

type Handle = Awaited<ReturnType<typeof serve>>

const handles = new Set<Handle>()
const apps = new Set<Miia>()

afterEach(async () => {
  const open = [...handles]
  handles.clear()
  const running = [...apps]
  apps.clear()
  await Promise.all([...open.map((handle) => handle.close()), ...running.map((app) => app.destroy())])
})

function freePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })
}

async function start(options: Omit<Parameters<typeof serve>[0], 'port'>): Promise<{ handle: Handle; port: number }> {
  const port = await freePort(options.hostname ?? '127.0.0.1')
  const handle = await serve({ hostname: '127.0.0.1', ...options, port })
  handles.add(handle)
  return { handle, port }
}

const silent: LoggerService = { log() {}, warn() {}, error() {} }

async function startApp(setup: (app: Miia) => void, host = '127.0.0.1'): Promise<{ app: Miia; port: number }> {
  const app = new Miia({ logger: silent, shutdownHooks: false })
  setup(app)
  const port = await freePort(host)
  await app.listen(port, host, serve)
  apps.add(app)
  return { app, port }
}

interface Wire {
  status: number
  headers: [string, string][]
  body: Buffer
}

type Parsed = { response: Wire; consumed: number } | { need: number }

/** One HTTP/1.1 response out of `buf`; `need` is how many bytes it takes before parsing again is worth it. */
function parse(buf: Buffer, head: boolean): Parsed {
  const end = buf.indexOf('\r\n\r\n')
  if (end === -1) return { need: buf.length + 1 }
  const [statusLine, ...lines] = buf.subarray(0, end).toString('latin1').split('\r\n')
  const headers = lines.map((line): [string, string] => {
    const colon = line.indexOf(':')
    return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]
  })
  const status = Number(statusLine!.split(' ')[1])
  const start = end + 4
  if (head) return { response: { status, headers, body: Buffer.alloc(0) }, consumed: start }
  if (headers.some(([name, value]) => name === 'transfer-encoding' && value === 'chunked')) {
    const parts: Buffer[] = []
    let offset = start
    while (true) {
      const eol = buf.indexOf('\r\n', offset)
      if (eol === -1) return { need: buf.length + 1 }
      const size = Number.parseInt(buf.subarray(offset, eol).toString('latin1'), 16)
      if (buf.length < eol + 4 + size) return { need: eol + 4 + size }
      parts.push(buf.subarray(eol + 2, eol + 2 + size))
      offset = eol + 4 + size
      if (size === 0) return { response: { status, headers, body: Buffer.concat(parts) }, consumed: offset }
    }
  }
  const length = Number(headers.find(([name]) => name === 'content-length')?.[1] ?? 0)
  if (buf.length < start + length) return { need: start + length }
  return { response: { status, headers, body: buf.subarray(start, start + length) }, consumed: start + length }
}

/** A raw keep-alive connection: the framing headers must be seen exactly as they went out, duplicates included. */
async function connect(port: number, host = '127.0.0.1') {
  const socket = net.connect(port, host)
  await once(socket, 'connect')
  let chunks: Buffer[] = []
  let size = 0
  let need = 0
  let closed = false
  let notify: (() => void) | null = null
  socket.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
    size += chunk.length
    if (size >= need) notify?.()
  })
  socket.on('error', () => {})
  socket.on('close', () => {
    closed = true
    notify?.()
  })

  /** The next response, or null when the server closed the connection before it was complete. */
  async function next(head = false): Promise<Wire | null> {
    need = 0
    while (true) {
      if (size >= need) {
        const buf = Buffer.concat(chunks)
        chunks = [buf]
        const parsed = parse(buf, head)
        if ('response' in parsed) {
          chunks = [buf.subarray(parsed.consumed)]
          size = chunks[0]!.length
          return parsed.response
        }
        need = parsed.need
      }
      if (closed) return null
      await new Promise<void>((resolve) => {
        notify = () => {
          notify = null
          resolve()
        }
      })
    }
  }

  const send = (method: string, path: string): void => {
    socket.write(`${method} ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`)
  }

  return { socket, send, next }
}

async function fetchRaw(port: number, method: string, path: string, host = '127.0.0.1'): Promise<Wire | null> {
  const conn = await connect(port, host)
  try {
    conn.send(method, path)
    return await conn.next(method === 'HEAD')
  } finally {
    conn.socket.destroy()
  }
}

function values(res: Wire, name: string): string[] {
  return res.headers.filter(([key]) => key === name).map(([, value]) => value)
}

function assertLength(res: Wire, length: number): void {
  assert.deepEqual(values(res, 'content-length'), [String(length)])
  assert.deepEqual(values(res, 'transfer-encoding'), [])
}

/** `promise`, or a rejection after `ms`: a response that never comes fails the test instead of holding the process. */
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

/** `total` bytes in 64KB chunks, read only as they are pulled. */
function sized(total: number): ReadableStream<Uint8Array> {
  let pulled = 0
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled >= total) return controller.close()
        const size = Math.min(65_536, total - pulled)
        controller.enqueue(new Uint8Array(size).fill(98))
        pulled += size
      },
    },
    { highWaterMark: 0 },
  )
}

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

const MODES = ['optimized', 'native'] as const

describe('response framing', () => {
  for (const mode of MODES) {
    describe(`${mode} mode`, () => {
      it('sends one Content-Length for a fixed body that declares its own', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: () => new Response('abc', { headers: { 'content-length': '3', 'x-kept': 'yes' } }),
        })

        const res = await fetchRaw(port, 'GET', '/fixed')
        assert.ok(res)
        assertLength(res, 3)
        assert.equal(res.body.toString(), 'abc')
        assert.deepEqual(values(res, 'x-kept'), ['yes'])
      })

      it('drops a forwarded transfer-encoding header', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: () => new Response('abc', { headers: { 'transfer-encoding': 'chunked' } }),
        })

        const res = await fetchRaw(port, 'GET', '/te')
        assert.ok(res)
        assert.equal(res.body.toString(), 'abc')
        if (mode === 'optimized') {
          assertLength(res, 3)
        } else {
          // A native body is a stream of unknown length, so uWS chunks it - with its own header only
          assert.deepEqual(values(res, 'transfer-encoding'), ['chunked'])
          assert.deepEqual(values(res, 'content-length'), [])
        }
      })

      it('sends one Content-Length: 0 for an empty body that declares it', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: (req) => new Response(req.url.endsWith('/null') ? null : '', { headers: { 'content-length': '0' } }),
        })

        for (const path of ['/empty', '/null']) {
          const res = await fetchRaw(port, 'GET', path)
          assert.ok(res, path)
          assertLength(res, 0)
          assert.equal(res.body.length, 0)
        }
      })

      it('reports a declared length on a HEAD answer without a body', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: (req) =>
            req.method === 'HEAD'
              ? new Response(null, { headers: { 'content-length': '5', 'content-type': 'text/plain' } })
              : new Response('after'),
        })

        const conn = await connect(port)
        try {
          conn.send('HEAD', '/head')
          const head = await conn.next(true)
          assert.ok(head)
          assert.equal(head.status, 200)
          assertLength(head, 5)

          // No body bytes went out, so the next response on the connection parses cleanly
          conn.send('GET', '/after')
          const after = await conn.next()
          assert.ok(after)
          assert.equal(after.body.toString(), 'after')
        } finally {
          conn.socket.destroy()
        }
      })

      it('sends no Content-Length on a HEAD answer that declares none', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: (req) =>
            req.method === 'HEAD'
              ? new Response(null, { headers: { 'content-type': 'text/plain' } })
              : new Response('after'),
        })

        const conn = await connect(port)
        try {
          conn.send('HEAD', '/head')
          const head = await within(conn.next(true), 2000, 'no answer to the HEAD request')
          assert.ok(head)
          assert.deepEqual(values(head, 'content-length'), [])
          assert.deepEqual(values(head, 'transfer-encoding'), [])

          conn.send('GET', '/after')
          const after = await within(conn.next(), 2000, 'no answer to the GET after the HEAD')
          assert.equal(after?.body.toString(), 'after')
        } finally {
          conn.socket.destroy()
        }
      })

      it('answers a GET with no body and a declared length with an empty body', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: (req) =>
            new URL(req.url).pathname === '/next'
              ? new Response('next')
              : new Response(null, { headers: { 'content-length': '5' } }),
        })

        const conn = await connect(port)
        try {
          conn.send('GET', '/empty')
          const res = await within(conn.next(), 2000, 'the response waits for a body that never comes')
          assert.ok(res)
          assertLength(res, 0)
          assert.equal(res.body.length, 0)

          conn.send('GET', '/next')
          const next = await within(conn.next(), 2000, 'no answer to the next request')
          assert.equal(next?.body.toString(), 'next')
        } finally {
          conn.socket.destroy()
        }
      })

      it('reports a declared length on a 304 without a body', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: (req) =>
            new URL(req.url).pathname === '/cached'
              ? new Response(null, { status: 304, headers: { 'content-length': '5', etag: '"v1"' } })
              : new Response('after'),
        })

        const conn = await connect(port)
        try {
          conn.send('GET', '/cached')
          const res = await within(conn.next(true), 2000, 'no answer to the conditional GET')
          assert.ok(res)
          assert.equal(res.status, 304)
          assertLength(res, 5)

          conn.send('GET', '/after')
          const after = await within(conn.next(), 2000, 'no answer to the GET after the 304')
          assert.equal(after?.body.toString(), 'after')
        } finally {
          conn.socket.destroy()
        }
      })

      it('streams a body with a declared length under one Content-Length', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: () => new Response(streamOf('chunk1', 'chunk2', 'chunk3'), { headers: { 'content-length': '18' } }),
        })

        const res = await fetchRaw(port, 'GET', '/stream')
        assert.ok(res)
        assertLength(res, 18)
        assert.equal(res.body.toString(), 'chunk1chunk2chunk3')
      })

      it('keeps a streamed body without a declared length chunked', { timeout: 5000 }, async () => {
        const { port } = await start({ mode, fetch: () => new Response(streamOf('part1', 'part2')) })

        const res = await fetchRaw(port, 'GET', '/chunked')
        assert.ok(res)
        assert.deepEqual(values(res, 'transfer-encoding'), ['chunked'])
        assert.deepEqual(values(res, 'content-length'), [])
        assert.equal(res.body.toString(), 'part1part2')
      })

      it('closes the connection when the source is shorter or longer than declared', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: (req) => {
            const path = new URL(req.url).pathname
            if (path === '/short') return new Response(streamOf('abc'), { headers: { 'content-length': '5' } })
            if (path === '/long-chunk') return new Response(streamOf('abcdef'), { headers: { 'content-length': '5' } })
            if (path === '/long-tail')
              return new Response(streamOf('abcde', 'f'), { headers: { 'content-length': '5' } })
            return new Response('ok')
          },
        })

        for (const path of ['/short', '/long-chunk', '/long-tail']) {
          assert.equal(await fetchRaw(port, 'GET', path), null, `${path} should not get a complete response`)
        }
        const res = await fetchRaw(port, 'GET', '/ok')
        assert.ok(res)
        assert.equal(res.body.toString(), 'ok')
      })

      it('closes the connection when a body with a declared length errors', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: () => {
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('ab'))
                setTimeout(() => controller.error(new Error('source failed')), 20)
              },
            })
            return new Response(body, { headers: { 'content-length': '5' } })
          },
        })

        assert.equal(await fetchRaw(port, 'GET', '/broken'), null)
      })

      it('sends no Content-Length on a 204', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: (req) => {
            const path = new URL(req.url).pathname
            if (path === '/declared') return new Response(null, { status: 204, headers: { 'content-length': '0' } })
            if (path === '/none') return new Response(null, { status: 204 })
            return new Response('after')
          },
        })

        const conn = await connect(port)
        try {
          for (const path of ['/none', '/declared']) {
            conn.send('GET', path)
            const res = await within(conn.next(true), 2000, `no answer for ${path}`)
            assert.ok(res)
            assert.equal(res.status, 204)
            assert.deepEqual(values(res, 'content-length'), [], path)
            assert.deepEqual(values(res, 'transfer-encoding'), [], path)
          }
          conn.send('GET', '/after')
          const after = await within(conn.next(), 2000, 'no answer after the 204s')
          assert.equal(after?.body.toString(), 'after')
        } finally {
          conn.socket.destroy()
        }
      })

      it('cancels a chunked source when the client goes away', { timeout: 5000 }, async () => {
        let cancelled = false
        let timer: ReturnType<typeof setInterval> | undefined
        const { port } = await start({
          mode,
          fetch: () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  timer = setInterval(() => controller.enqueue(new TextEncoder().encode('data: tick\n\n')), 10)
                },
                cancel() {
                  cancelled = true
                  clearInterval(timer)
                },
              }),
            ),
        })

        const conn = await connect(port)
        try {
          conn.send('GET', '/events')
          await sleep(100)
          conn.socket.destroy()
          await until(() => cancelled, 2000)
        } finally {
          clearInterval(timer)
          conn.socket.destroy()
        }
      })

      for (const framing of ['chunked', 'declared-length'] as const) {
        it(`cancels a ${framing} source that has gone quiet when the client goes away`, { timeout: 5000 }, async () => {
          let cancelled = false
          const { port } = await start({
            mode,
            fetch: () =>
              new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode('data: 1\n\n'))
                  },
                  cancel() {
                    cancelled = true
                  },
                }),
                framing === 'chunked' ? undefined : { headers: { 'content-length': '1000' } },
              ),
          })

          const conn = await connect(port)
          try {
            const first = once(conn.socket, 'data')
            conn.send('GET', '/events')
            await within(first, 2000, 'the first event did not arrive')
            conn.socket.destroy()
            // The source sends nothing more, so only the client going away can stop it
            await until(() => cancelled, 200)
          } finally {
            conn.socket.destroy()
          }
        })
      }

      it('gives up an unread request body that piles up while the response waits for the client', {
        timeout: 15000,
      }, async () => {
        const total = 16 * 1024 * 1024
        let bodyError = ''
        const { port } = await start({
          mode,
          maxBodySize: false,
          fetch: (req) => {
            req.body!.getReader().closed.catch((error: Error) => {
              bodyError = error.message
            })
            return new Response(sized(total), { headers: { 'content-length': String(total) } })
          },
        })

        const conn = await connect(port)
        try {
          // The response fills the socket and waits; the body that arrives meanwhile is read off the socket
          conn.socket.pause()
          conn.socket.write(`POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${8 * 1024 * 1024}\r\n\r\n`)
          await sleep(200)
          conn.socket.write(Buffer.alloc(6 * 1024 * 1024, 97))
          await until(() => bodyError !== '', 3000).catch(() => {})
          assert.match(bodyError, /piled up unread/, 'the unread body was kept whole while the response waited')

          conn.socket.resume()
          const res = await within(conn.next(), 10000, 'the response did not arrive')
          assert.equal(res?.body.length, total)
        } finally {
          conn.socket.destroy()
        }
      })

      it('closes the connection when a chunked body errors', { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          fetch: () => {
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('ab'))
                setTimeout(() => controller.error(new Error('source failed')), 20)
              },
            })
            return new Response(body)
          },
        })

        assert.equal(await fetchRaw(port, 'GET', '/broken'), null, 'the cut-off body ended like a complete one')
      })

      for (const framing of ['declared-length', 'chunked'] as const) {
        const init = framing === 'chunked' ? undefined : { headers: { 'content-length': String(16 * 1024 * 1024) } }
        const upload = `POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${4 * 1024 * 1024}\r\n\r\n`

        it(`keeps sending a ${framing} response when the unread request body fills up meanwhile`, {
          timeout: 15000,
        }, async () => {
          const { port } = await start({
            mode,
            maxBodySize: false,
            fetch: () => new Response(sized(16 * 1024 * 1024), init),
          })

          const conn = await connect(port)
          try {
            // The response fills the socket and waits for a writable event; the body that arrives then is not read
            conn.socket.pause()
            conn.socket.write(upload)
            await sleep(200)
            conn.socket.write(Buffer.alloc(1024 * 1024, 97))
            await sleep(200)
            conn.socket.resume()
            const res = await within(conn.next(), 10000, 'the response stalled behind the paused request body')
            assert.ok(res)
            assert.equal(res.body.length, 16 * 1024 * 1024)
          } finally {
            conn.socket.destroy()
          }
        })

        it(`sends a ${framing} response after the unread request body has paused the socket`, {
          timeout: 15000,
        }, async () => {
          const { port } = await start({
            mode,
            maxBodySize: false,
            fetch: async () => {
              await sleep(200)
              return new Response(sized(16 * 1024 * 1024), init)
            },
          })

          const conn = await connect(port)
          try {
            conn.socket.write(upload)
            conn.socket.write(Buffer.alloc(1024 * 1024, 97))
            const res = await within(conn.next(), 10000, 'the response stalled behind the paused request body')
            assert.ok(res)
            assert.equal(res.body.length, 16 * 1024 * 1024)
          } finally {
            conn.socket.destroy()
          }
        })
      }

      for (const sync of [true, false]) {
        it(`closes the connection when writing the response throws midway (${sync ? 'sync' : 'async'} fetch)`, {
          timeout: 5000,
        }, async () => {
          const broken = { status: 200 } as unknown as Response
          const { port } = await start({
            mode,
            logger: silent,
            fetch: sync ? () => broken : async () => broken,
          })

          const conn = await connect(port)
          try {
            conn.send('GET', '/broken')
            assert.equal(await within(conn.next(), 2000, 'the half-written response was left open'), null)
          } finally {
            conn.socket.destroy()
          }
        })
      }
    })
  }

  it("keeps one Content-Length on core's HEAD answer for a GET route", { timeout: 5000 }, async () => {
    const { port } = await startApp((app) => {
      app.addRoute('GET', '/file', () => new Response('hello', { headers: { 'content-length': '5' } }))
    })

    const conn = await connect(port)
    try {
      conn.send('HEAD', '/file')
      const head = await conn.next(true)
      assert.ok(head)
      assert.equal(head.status, 200)
      assertLength(head, 5)

      conn.send('GET', '/file')
      const get = await conn.next()
      assert.ok(get)
      assertLength(get, 5)
      assert.equal(get.body.toString(), 'hello')
    } finally {
      conn.socket.destroy()
    }
  })

  describe('a large streamed body', () => {
    const TOTAL = 32 * 1024 * 1024
    const CHUNK = 64 * 1024
    const pattern = Buffer.alloc(TOTAL)
    for (let i = 0; i < TOTAL; i++) pattern[i] = i % 251

    function source(progress: { pulled: number; cancelled: boolean }): ReadableStream<Uint8Array> {
      return new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (progress.pulled >= TOTAL) return controller.close()
            controller.enqueue(new Uint8Array(pattern.subarray(progress.pulled, progress.pulled + CHUNK)))
            progress.pulled += CHUNK
          },
          cancel() {
            progress.cancelled = true
          },
        },
        { highWaterMark: 0 },
      )
    }

    it('with a declared length: reads the source at the pace of the client and sends it intact', {
      timeout: 15000,
    }, async () => {
      const progress = { pulled: 0, cancelled: false }
      const { port } = await start({
        fetch: () => new Response(source(progress), { headers: { 'content-length': String(TOTAL) } }),
      })

      const conn = await connect(port)
      try {
        conn.socket.pause()
        conn.send('GET', '/large')
        await sleep(500)
        assert.ok(
          progress.pulled < TOTAL / 2,
          `the source was read ahead of the client: ${progress.pulled} of ${TOTAL}`,
        )

        conn.socket.resume()
        const res = await conn.next()
        assert.ok(res)
        assertLength(res, TOTAL)
        assert.ok(res.body.equals(pattern), 'the body arrived corrupted')
      } finally {
        conn.socket.destroy()
      }
    })

    it('chunked: reads the source at the pace of the client and sends it intact', { timeout: 15000 }, async () => {
      const progress = { pulled: 0, cancelled: false }
      const { port } = await start({ fetch: () => new Response(source(progress)) })

      const conn = await connect(port)
      try {
        conn.socket.pause()
        conn.send('GET', '/large')
        await sleep(500)
        assert.ok(
          progress.pulled < TOTAL / 2,
          `the source was read ahead of the client: ${progress.pulled} of ${TOTAL}`,
        )

        conn.socket.resume()
        const res = await within(conn.next(), 10000, 'the chunked body did not arrive')
        assert.ok(res)
        assert.deepEqual(values(res, 'transfer-encoding'), ['chunked'])
        assert.ok(res.body.equals(pattern), 'the body arrived corrupted')
      } finally {
        conn.socket.destroy()
      }
    })

    it('with a declared length: cancels the source when the client goes away under backpressure', {
      timeout: 5000,
    }, async () => {
      const progress = { pulled: 0, cancelled: false }
      const { port } = await start({
        fetch: () => new Response(source(progress), { headers: { 'content-length': String(TOTAL) } }),
      })

      const conn = await connect(port)
      conn.socket.pause()
      conn.send('GET', '/large')
      await sleep(300)
      conn.socket.destroy()
      const deadline = Date.now() + 2000
      while (!progress.cancelled && Date.now() < deadline) await sleep(10)
      assert.ok(progress.cancelled, 'the source was left open')
      assert.ok(progress.pulled < TOTAL)
    })
  })
})

describe('a declared Content-Length over maxBodySize', () => {
  const PAYLOAD = 8 * 1024 * 1024

  /** node:http writing a declared body at its own pace - it keeps writing until it sees the answer. */
  function upload(port: number): Promise<{ status: number; connection: string | undefined }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: 'POST', path: '/upload', headers: { 'content-length': String(PAYLOAD) } },
        (res) => {
          res.resume()
          resolve({ status: res.statusCode!, connection: res.headers.connection })
        },
      )
      // An error after the answer (the client closing under its own upload) settles nothing
      req.on('error', reject)
      const chunk = Buffer.alloc(65_536, 97)
      let sent = 0
      const pump = () => {
        while (sent < PAYLOAD) {
          sent += chunk.length
          if (!req.write(chunk)) return void req.once('drain', pump)
        }
        req.end()
      }
      pump()
    })
  }

  /**
   * A client that writes the whole request before it reads anything, as a synchronous client does: the headers, and
   * `delay` ms later 4 MB of body. Returns what it reads after that, the reset it met instead, or nothing.
   */
  async function writeThenRead(port: number, delay: number): Promise<string> {
    const socket = net.connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.pause()
    let failure = ''
    socket.on('error', (error: NodeJS.ErrnoException) => {
      failure = error.code ?? error.message
    })
    // Not once(): it rejects on the reset this client may meet
    const closed = new Promise((resolve) => socket.once('close', resolve))
    try {
      const size = 4 * 1024 * 1024
      socket.write(`POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${size}\r\n\r\n`)
      await sleep(delay)
      const chunk = Buffer.alloc(65_536, 97)
      const drained = () => new Promise((resolve) => socket.once('drain', resolve))
      for (let sent = 0; sent < size && !failure && !socket.destroyed; sent += chunk.length) {
        if (!socket.write(chunk)) await Promise.race([drained(), closed, sleep(2000)])
      }
      let received = ''
      socket.setEncoding('latin1')
      socket.on('data', (part: string) => {
        received += part
      })
      socket.resume()
      await until(() => /\r\n\r\n/.test(received) || failure !== '' || socket.destroyed, 3000).catch(() => {})
      return received || failure
    } finally {
      socket.destroy()
    }
  }

  for (const mode of MODES) {
    describe(`${mode} mode`, () => {
      it('answers a request that sends only the headers with a 413 that says Connection: close', {
        timeout: 5000,
      }, async () => {
        let called = false
        const { port } = await start({
          mode,
          maxBodySize: 1000,
          fetch: () => {
            called = true
            return new Response('ok')
          },
        })
        const conn = await connect(port)
        try {
          conn.socket.write('POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5000\r\n\r\n')
          const res = await within(conn.next(), 2000, 'no answer')
          assert.equal(res?.status, 413)
          // The client closes as told; one that does not is closed by uWS's idle timeout, about 10 s
          assert.deepEqual(values(res!, 'connection'), ['close'])
          assert.equal(called, false)
        } finally {
          conn.socket.destroy()
        }
      })

      it('says Connection: close on the 413 to an upload under way, which gets it', { timeout: 10000 }, async () => {
        const { port } = await start({ mode, maxBodySize: 1000, fetch: () => new Response('ok') })
        assert.deepEqual(await upload(port), { status: 413, connection: 'close' })
      })

      it('gets the 413 to a client whose body starts in a read of its own', { timeout: 10000 }, async () => {
        const { port } = await start({ mode, maxBodySize: 1000, fetch: () => new Response('ok') })
        assert.match(await writeThenRead(port, 30), /^HTTP\/1\.1 413\r\n/)
      })

      it('says Connection: close on the 413 after the 100 Continue uWS sends', { timeout: 5000 }, async () => {
        const { port } = await start({ mode, maxBodySize: 1000, fetch: () => new Response('ok') })
        const conn = await connect(port)
        try {
          conn.socket.write(
            'POST /upload HTTP/1.1\r\nHost: localhost\r\nExpect: 100-continue\r\nContent-Length: 5000\r\n\r\n',
          )
          const interim = await within(conn.next(), 2000, 'no 100 Continue')
          assert.equal(interim?.status, 100)
          const res = await within(conn.next(), 2000, 'no answer')
          assert.equal(res?.status, 413)
          assert.deepEqual(values(res!, 'connection'), ['close'])
        } finally {
          conn.socket.destroy()
        }
      })
    })
  }
})

describe('a Host header that makes no valid URL', () => {
  const cases = [
    ['x:99999', 'text'],
    ['[::1', 'body'],
  ] as const

  for (const mode of MODES) {
    for (const [host, read] of cases) {
      it(`reads the body through ${read} under Host ${host} in ${mode} mode`, { timeout: 5000 }, async () => {
        const { port } = await start({
          mode,
          logger: silent,
          fetch: async (req) =>
            Response.json({ url: req.url, text: await (read === 'text' ? req.text() : new Response(req.body).text()) }),
        })
        const conn = await connect(port)
        try {
          conn.socket.write(
            `POST /p?q=1 HTTP/1.1\r\nHost: ${host}\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n`,
          )
          const res = await within(conn.next(), 2000, 'no answer')
          assert.equal(res?.status, 200)
          // Optimized mode keeps the URL as it came, as Bun and Deno do; a real Request needs one that parses
          const url = mode === 'optimized' ? `http://${host}/p?q=1` : 'http://localhost/p?q=1'
          assert.deepEqual(JSON.parse(res!.body.toString()), { url, text: 'hello' })
        } finally {
          conn.socket.destroy()
        }
      })
    }
  }
})

describe('a Host header with more than a host in it', () => {
  // uWS answers a Host with userinfo (`u@x`) with a 400 itself
  const hosts = ['x/admin', 'x\\admin', 'x?q=/admin', 'x#f']

  for (const mode of MODES) {
    it(`routes by the request target, not the Host, in ${mode} mode`, { timeout: 5000 }, async () => {
      const app = new Miia({ logger: silent, shutdownHooks: false })
      app.addRoute('GET', '/admin/public', () => ({ route: 'admin' }))
      app.addRoute('GET', '/public', (ctx) => ({ route: 'public', url: ctx.req.url }))
      await app.init()
      apps.add(app)
      const { port } = await start({ mode, fetch: app.fetch })

      for (const host of hosts) {
        const conn = await connect(port)
        try {
          conn.socket.write(`GET /public HTTP/1.1\r\nHost: ${host}\r\n\r\n`)
          const res = await within(conn.next(), 2000, `no answer under Host ${host}`)
          assert.equal(res?.status, 200, `Host ${host}`)
          const body = JSON.parse(res!.body.toString())
          assert.equal(body.route, 'public', `Host ${host}`)
          // Optimized mode keeps the Host in the URL as it came, as Bun and Deno do; native mode builds it on localhost
          if (mode === 'native') assert.equal(body.url, 'http://localhost/public', `Host ${host}`)
        } finally {
          conn.socket.destroy()
        }
      }
    })
  }

  it('keeps a Host that is host[:port] or [IPv6]:port in native mode', { timeout: 5000 }, async () => {
    const { port } = await start({ mode: 'native', fetch: (req) => new Response(req.url) })
    const cases = [
      ['example.com:8080', 'http://example.com:8080/p?q=1'],
      ['EXAMPLE.com', 'http://example.com/p?q=1'],
      ['[::1]:8080', 'http://[::1]:8080/p?q=1'],
    ]
    for (const [host, url] of cases) {
      const conn = await connect(port)
      try {
        conn.socket.write(`GET /p?q=1 HTTP/1.1\r\nHost: ${host}\r\n\r\n`)
        const res = await within(conn.next(), 2000, `no answer under Host ${host}`)
        assert.equal(res?.body.toString(), url)
      } finally {
        conn.socket.destroy()
      }
    }
  })
})

describe('a method a Request cannot carry', () => {
  it('gets a 501 in native mode, and the connection carries on', { timeout: 5000 }, async () => {
    let reached = false
    const { port } = await start({
      mode: 'native',
      fetch: () => {
        reached = true
        return new Response('ok')
      },
    })
    const conn = await connect(port)
    try {
      for (const method of ['TRACE', 'TRACK', 'CONNECT']) {
        conn.send(method, '/')
        const res = await within(conn.next(), 2000, `no answer to ${method}`)
        assert.equal(res?.status, 501, method)
        assert.deepEqual(JSON.parse(res!.body.toString()), {
          statusCode: 501,
          error: 'Not Implemented',
          message: 'Not Implemented',
        })
      }
      assert.equal(reached, false)
      conn.send('GET', '/')
      assert.equal((await within(conn.next(), 2000, 'no answer after the 501s'))?.status, 200)
    } finally {
      conn.socket.destroy()
    }
  })

  it('drops the body of a refused request in native mode', { timeout: 5000 }, async () => {
    const { port } = await start({ mode: 'native', fetch: () => new Response('ok') })
    const conn = await connect(port)
    try {
      conn.socket.write('TRACE / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello')
      assert.equal((await within(conn.next(), 2000, 'no answer to the TRACE'))?.status, 501)
      conn.send('GET', '/')
      const res = await within(conn.next(), 2000, 'no answer after the TRACE')
      assert.equal(res?.status, 200)
      assert.equal(res?.body.toString(), 'ok')
    } finally {
      conn.socket.destroy()
    }
  })

  it('gets a 400 for a method that is not a token in native mode', { timeout: 5000 }, async () => {
    const { port } = await start({ mode: 'native', fetch: () => new Response('ok') })
    const res = await fetchRaw(port, 'GE(T', '/')
    assert.equal(res?.status, 400)
    assert.equal((await fetchRaw(port, 'GET', '/'))?.status, 200)
  })

  it('reaches the app in optimized mode, as on Bun and Deno', { timeout: 5000 }, async () => {
    const { port } = await start({ fetch: (req) => new Response(req.method) })
    const res = await fetchRaw(port, 'TRACE', '/')
    assert.equal(res?.status, 200)
    assert.equal(res?.body.toString(), 'TRACE')
  })
})

describe('idle keep-alive connections', () => {
  it('are closed after a HEAD answer with a declared length or a 204, as after any other', {
    timeout: 30000,
  }, async () => {
    const cases = MODES.flatMap((mode) => [
      { mode, method: 'HEAD', response: () => new Response(null, { headers: { 'content-length': '5' } }) },
      { mode, method: 'GET', response: () => new Response(null, { status: 204 }) },
    ])
    await Promise.all(
      cases.map(async ({ mode, method, response }) => {
        const { port } = await start({ mode, fetch: response })
        const conn = await connect(port)
        try {
          const closed = once(conn.socket, 'close')
          conn.send(method, '/file')
          const res = await within(conn.next(true), 2000, `${mode} ${method}: no answer`)
          assert.ok(res)
          // uWS closes an idle HTTP connection after about 10 s
          await within(closed, 20000, `${mode} ${method} ${res.status}: the idle connection was still open after 20 s`)
        } finally {
          conn.socket.destroy()
        }
      }),
    )
  })
})

async function hasIPv6Loopback(): Promise<boolean> {
  try {
    await freePort('::1')
    return true
  } catch {
    return false
  }
}

// uWS gives an IPv6 address expanded, where Node, Bun and Deno give `::1`
const LOOPBACK6 = '0000:0000:0000:0000:0000:0000:0000:0001'

describe('client address', () => {
  for (const mode of MODES) {
    it(`gives an IPv6 client's connection info as plain data in ${mode} mode`, { timeout: 5000 }, async (t) => {
      if (!(await hasIPv6Loopback())) return t.skip('IPv6 loopback unavailable')
      const { port } = await start({
        hostname: '::1',
        mode,
        fetch: (req) => {
          const conn = (req as any)._conn
          return Response.json({ spread: { ...conn }, json: JSON.parse(JSON.stringify(conn)) })
        },
      })

      const res = await fetchRaw(port, 'GET', '/conn', '::1')
      assert.ok(res)
      const seen = JSON.parse(res.body.toString())
      assert.equal(seen.spread.remoteAddress, LOOPBACK6)
      assert.equal(seen.json.remoteAddress, LOOPBACK6)
    })

    it(`reports an IPv6 loopback client as uWS gives it in ${mode} mode`, { timeout: 5000 }, async (t) => {
      if (!(await hasIPv6Loopback())) return t.skip('IPv6 loopback unavailable')
      const { port } = await start({ hostname: '::1', mode, fetch: (req) => Response.json((req as any)._conn) })

      const res = await fetchRaw(port, 'GET', '/conn', '::1')
      assert.ok(res)
      const conn = JSON.parse(res.body.toString())
      assert.equal(conn.remoteAddress, LOOPBACK6)
      assert.equal(conn.family, 'IPv6')
    })
  }

  it('builds the connection info only when it is read in optimized mode', { timeout: 5000 }, async (t) => {
    if (!(await hasIPv6Loopback())) return t.skip('IPv6 loopback unavailable')
    const { port } = await start({
      hostname: '::1',
      fetch: (req) => {
        const before = (req as any)._connCache
        const conn = (req as any)._conn
        return Response.json({ before, cached: (req as any)._connCache === conn, address: conn.remoteAddress })
      },
    })

    const res = await fetchRaw(port, 'GET', '/conn', '::1')
    assert.ok(res)
    assert.deepEqual(
      JSON.parse(res.body.toString()),
      { before: null, cached: true, address: LOOPBACK6 },
      'the connection info was built for a request that had not read it yet',
    )
  })

  it('gives ctx.ip and ctx.conn the same address through Miia', { timeout: 5000 }, async (t) => {
    if (!(await hasIPv6Loopback())) return t.skip('IPv6 loopback unavailable')
    const { port } = await startApp((app) => {
      app.addRoute('GET', '/ip', (ctx) => ({ ip: ctx.ip, address: ctx.conn.remoteAddress, family: ctx.conn.family }))
    }, '::1')

    const res = await fetchRaw(port, 'GET', '/ip', '::1')
    assert.ok(res)
    assert.deepEqual(JSON.parse(res.body.toString()), { ip: LOOPBACK6, address: LOOPBACK6, family: 'IPv6' })
  })

  it('reports an IPv4 client of a dual-stack listener as an IPv4-mapped address', { timeout: 5000 }, async (t) => {
    if (!(await hasIPv6Loopback())) return t.skip('IPv6 loopback unavailable')
    const { port } = await start({ hostname: '::', fetch: (req) => Response.json((req as any)._conn) })

    const res = await fetchRaw(port, 'GET', '/conn', '127.0.0.1')
    assert.ok(res)
    const conn = JSON.parse(res.body.toString())
    assert.equal(conn.remoteAddress, '0000:0000:0000:0000:0000:ffff:7f00:0001')
    assert.equal(conn.family, 'IPv6')
  })
})

async function until(condition: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await sleep(5)
  }
}

/** Sleeps for `?ms=` before answering, and counts the answers it has produced. */
function sleeper(state: { answered: number }) {
  return async (req: Request): Promise<Response> => {
    const ms = Number(new URL(req.url).searchParams.get('ms') ?? 0)
    await sleep(ms)
    state.answered++
    return new Response(`slept ${ms}`)
  }
}

describe('shutdown', () => {
  for (const mode of MODES) {
    it(`close() waits for a request in flight in ${mode} mode`, { timeout: 5000 }, async () => {
      const state = { answered: 0 }
      const { handle, port } = await start({ mode, fetch: sleeper(state) })
      handles.delete(handle)

      const conn = await connect(port)
      try {
        conn.send('GET', '/slow?ms=300')
        const response = conn.next()
        await sleep(50)
        const started = Date.now()
        await handle.close()
        assert.equal(state.answered, 1, 'close() resolved before the response was out')
        assert.ok(Date.now() - started >= 200, `close() resolved after ${Date.now() - started} ms`)

        const res = await response
        assert.ok(res, 'the response was cut off')
        assert.equal(res.status, 200)
        assert.equal(res.body.toString(), 'slept 300')
      } finally {
        conn.socket.destroy()
      }
    })

    it(`close() does not wait for a request whose client went away in ${mode} mode`, { timeout: 5000 }, async () => {
      let reached = false
      const { handle, port } = await start({
        mode,
        fetch: () => {
          reached = true
          return new Promise<Response>(() => {})
        },
      })
      handles.delete(handle)

      const conn = await connect(port)
      conn.send('GET', '/hang')
      await until(() => reached)
      conn.socket.destroy()
      const started = Date.now()
      await handle.close()
      assert.ok(Date.now() - started < 1000, `close() took ${Date.now() - started} ms`)
    })
  }

  it('close() waits until a large streamed body has been sent in native mode', { timeout: 15000 }, async () => {
    const total = 32 * 1024 * 1024
    const payload = new Uint8Array(total).fill(7)
    // A chunked stream of one chunk; optimized mode hands a body in memory to uWS whole, and it counts as out then
    const { handle, port } = await start({ mode: 'native', fetch: () => new Response(payload) })
    handles.delete(handle)

    const conn = await connect(port)
    try {
      conn.socket.pause()
      conn.send('GET', '/large')
      await sleep(200)
      let closed = false
      const closing = handle.close().then(() => {
        closed = true
      })
      await sleep(300)
      assert.equal(closed, false, 'close() resolved while most of the body was still to be sent')

      conn.socket.resume()
      const res = await within(conn.next(), 10000, 'the body did not arrive')
      assert.ok(res)
      assert.equal(res.body.length, total)
      await within(closing, 2000, 'close() did not resolve once the body was sent')
    } finally {
      conn.socket.destroy()
    }
  })

  it('close() waits for a streamed response to end', { timeout: 5000 }, async () => {
    let ended = false
    const { handle, port } = await start({
      fetch: () => {
        const encoder = new TextEncoder()
        let sent = 0
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            await sleep(60)
            if (sent === 5) {
              ended = true
              return controller.close()
            }
            controller.enqueue(encoder.encode(`part${sent++}`))
          },
        })
        return new Response(body)
      },
    })
    handles.delete(handle)

    const conn = await connect(port)
    try {
      conn.send('GET', '/stream')
      const response = conn.next()
      await sleep(30)
      await handle.close()
      assert.equal(ended, true, 'close() resolved before the stream ended')

      const res = await response
      assert.ok(res)
      assert.equal(res.body.toString(), 'part0part1part2part3part4')
    } finally {
      conn.socket.destroy()
    }
  })

  for (const mode of MODES) {
    it(`serves nothing on a kept-alive connection once close() has resolved in ${mode} mode`, {
      timeout: 5000,
    }, async () => {
      const { handle, port } = await start({ mode, fetch: () => new Response('ok') })
      handles.delete(handle)

      const conn = await connect(port)
      try {
        conn.send('GET', '/first')
        assert.ok(await within(conn.next(), 2000, 'no answer to the first request'))
        await handle.close()
        conn.send('GET', '/after')
        const after = await within(conn.next(), 2000, 'the connection was left open, unanswered')
        assert.equal(after, null, 'a request was served after close()')
      } finally {
        conn.socket.destroy()
      }
    })
  }

  it('close() resolves at once with nothing in flight, idle keep-alive included', { timeout: 5000 }, async () => {
    const { handle, port } = await start({ fetch: () => new Response('ok') })
    handles.delete(handle)

    const conn = await connect(port)
    try {
      conn.send('GET', '/')
      assert.ok(await conn.next())
      const started = Date.now()
      await handle.close()
      assert.ok(Date.now() - started < 100, `close() took ${Date.now() - started} ms`)
    } finally {
      conn.socket.destroy()
    }
  })

  it('serves and waits for a request arriving on a kept-alive connection during the drain', {
    timeout: 5000,
  }, async () => {
    const state = { answered: 0 }
    const { handle, port } = await start({ fetch: sleeper(state) })
    handles.delete(handle)

    const first = await connect(port)
    const second = await connect(port)
    try {
      second.send('GET', '/warm')
      assert.ok(await second.next())

      first.send('GET', '/slow?ms=300')
      const firstResponse = first.next()
      await sleep(50)
      let closed = false
      const closing = handle.close().then(() => {
        closed = true
      })
      await sleep(50)
      second.send('GET', '/late?ms=400')

      const one = await firstResponse
      assert.ok(one)
      assert.equal(one.body.toString(), 'slept 300')
      assert.equal(closed, false, 'close() resolved while the late request was in flight')

      const two = await second.next()
      assert.ok(two, 'the late request was not served')
      assert.equal(two.body.toString(), 'slept 400')
      await closing
      assert.equal(state.answered, 3)
    } finally {
      first.socket.destroy()
      second.socket.destroy()
    }
  })

  it('lets app.destroy() finish a request in flight', { timeout: 5000 }, async () => {
    let answered = false
    const { app, port } = await startApp((app) => {
      app.addRoute('GET', '/slow', async () => {
        await sleep(300)
        answered = true
        return { ok: true }
      })
    })
    apps.delete(app)

    const conn = await connect(port)
    try {
      conn.send('GET', '/slow')
      const response = conn.next()
      await sleep(50)
      await app.destroy()
      assert.equal(answered, true, 'destroy() resolved before the response was out')

      const res = await response
      assert.ok(res, 'the response was cut off')
      assert.equal(res.status, 200)
      assert.deepEqual(JSON.parse(res.body.toString()), { ok: true })
    } finally {
      conn.socket.destroy()
    }
  })

  for (const mode of MODES) {
    it(`a fetch resolving to something sendResponse cannot write does not hold close() in ${mode} mode`, {
      timeout: 5000,
    }, async () => {
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => unhandled.push(reason)
      const emitter: NodeJS.EventEmitter = process
      process.on('unhandledRejection', onUnhandled)
      try {
        const { handle, port } = await start({
          mode,
          logger: silent,
          fetch: async () => ({ status: 200 }) as unknown as Response,
        })
        handles.delete(handle)
        const conn = await connect(port)
        try {
          conn.send('GET', '/broken')
          await sleep(100)
          const started = Date.now()
          await handle.close()
          assert.ok(Date.now() - started < 500, `close() waited ${Date.now() - started} ms`)
          assert.deepEqual(unhandled, [])
        } finally {
          conn.socket.destroy()
        }
      } finally {
        emitter.off('unhandledRejection', onUnhandled)
      }
    })
  }
})
