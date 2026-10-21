import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import * as net from 'node:net'
import type { AddressInfo } from 'node:net'
import { Miia, type RequestContext } from '@miiajs/core'
import { serve } from '../dist/index.js'

const apps = new Set<Miia>()

afterEach(async () => {
  const running = [...apps]
  apps.clear()
  await Promise.all(running.map((app) => app.destroy()))
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

/** Posts `parts` to a one-route app and returns the JSON the handler answered with. */
async function exchange(parts: readonly string[], handler: (ctx: RequestContext) => unknown): Promise<any> {
  const app = new Miia({ logger: false, shutdownHooks: false })
  app.addRoute('POST', '/', handler)
  const port = await freePort()
  await app.listen(port, '127.0.0.1', serve)
  apps.add(app)
  const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
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
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode!, body }))
      },
    )
    req.on('error', reject)
    for (const part of parts) req.write(part)
    req.end()
  })
  assert.equal(res.status, 200)
  return JSON.parse(res.body)
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
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

// Node's own Request: the stream path hands it over, the buffer path rejects the same way
const BODY_USED = 'TypeError: Body is unusable: Body has already been read'

// One part goes out with Content-Length (buffer path), several with chunked framing (stream path)
const paths = [
  ['buffer', ['hello'], ['"hello"']],
  ['stream', ['hel', 'lo'], ['"hel', 'lo"']],
] as const

describe('uws-server: the body is read once, like a real Request', () => {
  for (const [path, parts, jsonParts] of paths) {
    it(`${path} path: ctx.req.arrayBuffer() after ctx.text() rejects with a TypeError`, async () => {
      const body = await exchange(parts, async (ctx) => {
        const text = await ctx.text()
        return { text, second: await outcome(() => ctx.req.arrayBuffer()), bodyUsed: ctx.req.bodyUsed }
      })
      assert.deepEqual(body, { text: 'hello', second: BODY_USED, bodyUsed: true })
    })

    it(`${path} path: ctx.req.text() twice - the second call rejects`, async () => {
      const body = await exchange(parts, async (ctx) => {
        const first = await ctx.req.text()
        return { first, second: await outcome(() => ctx.req.text()) }
      })
      assert.deepEqual(body, { first: 'hello', second: BODY_USED })
    })

    it(`${path} path: a read of ctx.req.body takes the body, ctx.text() after it rejects`, async () => {
      const body = await exchange(parts, async (ctx) => {
        const before = ctx.req.bodyUsed
        const raw = await readAll(ctx.req.body!)
        return { raw, before, after: ctx.req.bodyUsed, text: await outcome(() => ctx.text()) }
      })
      assert.deepEqual(body, { raw: 'hello', before: false, after: true, text: BODY_USED })
    })

    it(`${path} path: ctx.req.body handed out but not read leaves the body to ctx.text()`, async () => {
      const body = await exchange(parts, async (ctx) => {
        const stream = ctx.req.body!
        return { text: await ctx.text(), bodyUsed: ctx.req.bodyUsed, locked: stream.locked }
      })
      assert.deepEqual(body, { text: 'hello', bodyUsed: true, locked: true })
    })

    it(`${path} path: every consumer after ctx.text() rejects and the body stream is locked`, async () => {
      const body = await exchange(parts, async (ctx) => {
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
      assert.deepEqual(body, {
        json: BODY_USED,
        text: BODY_USED,
        arrayBuffer: BODY_USED,
        blob: BODY_USED,
        formData: BODY_USED,
        reader: 'TypeError',
      })
    })

    it(`${path} path: ctx.json() and ctx.text() still share one read`, async () => {
      const body = await exchange(jsonParts, async (ctx) => ({
        json: await ctx.json(),
        text: await ctx.text(),
        again: await ctx.json(),
      }))
      assert.deepEqual(body, { json: 'hello', text: '"hello"', again: 'hello' })
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
      assert.deepEqual(body, { text: 'hello', own: true, second: BODY_USED })
    })

    it(`${path} path: clone() after ctx.text() throws what Node's own Request throws`, async () => {
      const body = await exchange(parts, async (ctx) => {
        await ctx.text()
        return { clone: await outcome(async () => ctx.req.clone()) }
      })
      assert.deepEqual(body, { clone: 'TypeError: unusable' })
    })

    it(`${path} path: a clone taken before the body is read reads it too`, async () => {
      const body = await exchange(parts, async (ctx) => {
        const copy = ctx.req.clone()
        return { text: await ctx.text(), copy: await copy.text() }
      })
      assert.deepEqual(body, { text: 'hello', copy: 'hello' })
    })
  }
})
