import { afterEach, describe, expect, it } from 'bun:test'
import * as http from 'node:http'
import { Controller, Miia, Module, Post } from '@miiajs/core'
import type { Constructor } from '@miiajs/core'
import { serve } from '@miiajs/node-server'
import { Multipart } from '../src/index.js'
import type { MultipartContext } from '../src/index.js'

const encoder = new TextEncoder()

let nextPort = 18790
let running: Miia | null = null

/** Boots the controller on a real socket through the Node adapter. */
async function start(controller: Constructor): Promise<string> {
  @Module({ controllers: [controller] })
  class TestModule {}

  const port = nextPort++
  running = new Miia({ logger: false, shutdownHooks: false }).register(TestModule)
  await running.listen(port, '127.0.0.1', serve)
  return `http://127.0.0.1:${port}`
}

afterEach(async () => {
  await running?.destroy()
  running = null
})

function multipartBody(boundary: string, title: string, file: Uint8Array): Uint8Array {
  const head = encoder.encode(
    `--${boundary}\r\ncontent-disposition: form-data; name="title"\r\n\r\n${title}\r\n` +
      `--${boundary}\r\ncontent-disposition: form-data; name="doc"; filename="big.bin"\r\n` +
      'content-type: application/octet-stream\r\n\r\n',
  )
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + file.length + tail.length)
  body.set(head)
  body.set(file, head.length)
  body.set(tail, head.length + file.length)
  return body
}

function slice(body: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let i = 0; i < body.length; i += size) chunks.push(body.subarray(i, Math.min(i + size, body.length)))
  return chunks
}

/** Deterministic payload, so the handler can check the bytes it reassembled. */
function payload(size: number): { bytes: Uint8Array; checksum: number } {
  const bytes = new Uint8Array(size)
  let checksum = 0
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 7) % 251
    checksum = (checksum + bytes[i]) % 1_000_003
  }
  return { bytes, checksum }
}

interface RawResponse {
  status: number
  body: string
  /** Chunks that made it onto the wire before the server answered. */
  sent: number
}

/**
 * Sends the body without a `Content-Length`, one `write()` per chunk, so Node
 * frames it as `Transfer-Encoding: chunked` and the adapter takes its stream
 * path. Writing stops as soon as the server has answered - a mid-stream 413
 * arrives while the upload is still in flight.
 */
function postChunked(url: string, contentType: string, chunks: Uint8Array[]): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    let answered = false
    let sent = 0

    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: { 'content-type': contentType, connection: 'close' },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () => {
          answered = true
          resolve({ status: res.statusCode as number, body, sent })
        })
      },
    )

    // The server may drop the connection once it has written an early response;
    // that is not a client-visible failure.
    req.on('error', (error) => {
      if (!answered) reject(error)
    })

    void (async () => {
      for (const chunk of chunks) {
        if (answered || req.destroyed) break
        req.write(chunk)
        sent++
        await new Promise((tick) => setTimeout(tick, 1))
      }
      if (!answered && !req.destroyed) req.end()
    })()
  })
}

describe('node-server - buffered fast path', () => {
  it('delivers a small form whole', async () => {
    @Controller('/upload')
    class Ctrl {
      @Post('/form')
      @Multipart()
      async form(ctx: MultipartContext) {
        const seen: string[] = []
        for await (const part of ctx.parts) {
          if (part.type === 'field') seen.push(`field:${part.name}=${part.value}`)
          else seen.push(`file:${part.name}:${part.filename}:${new TextDecoder().decode(await part.bytes())}`)
        }
        // A declared Content-Length under the 100 KB threshold is what puts the
        // adapter on its buffered path.
        return { seen, contentLength: Number(ctx.req.headers.get('content-length')) }
      }
    }

    const base = await start(Ctrl)
    const form = new FormData()
    form.append('title', 'hello')
    form.append('doc', new File(['payload'], 'a.txt', { type: 'text/plain' }))

    const res = await fetch(`${base}/upload/form`, { method: 'POST', body: form, headers: { connection: 'close' } })
    expect(res.status).toBe(200)

    const result = (await res.json()) as { seen: string[]; contentLength: number }
    expect(result.seen).toEqual(['field:title=hello', 'file:doc:a.txt:payload'])
    expect(result.contentLength).toBeGreaterThan(0)
    expect(result.contentLength).toBeLessThanOrEqual(102_400)
  })
})

describe('node-server - stream path', () => {
  it('reassembles a chunked upload byte for byte', async () => {
    @Controller('/upload')
    class Ctrl {
      @Post('/stream')
      @Multipart()
      async stream(ctx: MultipartContext) {
        let title = ''
        let size = 0
        let checksum = 0
        for await (const part of ctx.parts) {
          if (part.type === 'field') {
            title = part.value
            continue
          }
          const reader = part.stream.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.length
            for (const byte of value) checksum = (checksum + byte) % 1_000_003
          }
        }
        return { title, size, checksum, contentLength: ctx.req.headers.get('content-length') }
      }
    }

    const base = await start(Ctrl)
    const file = payload(300 * 1024)
    const body = multipartBody('stream-bnd', 'chunked', file.bytes)
    const chunks = slice(body, 16 * 1024)

    const res = await postChunked(`${base}/upload/stream`, 'multipart/form-data; boundary=stream-bnd', chunks)
    expect(res.status).toBe(200)
    expect(res.sent).toBe(chunks.length)
    expect(JSON.parse(res.body)).toEqual({
      title: 'chunked',
      size: file.bytes.length,
      checksum: file.checksum,
      contentLength: null,
    })
  })
})

describe('node-server - mid-stream limit', () => {
  const maxFileSize = 32 * 1024

  it('answers 413 on a live socket instead of dropping the connection', async () => {
    let delivered = -1

    @Controller('/upload')
    class Ctrl {
      @Post('/limited')
      @Multipart({ maxFileSize })
      async limited(ctx: MultipartContext) {
        let size = 0
        try {
          for await (const part of ctx.parts) {
            if (part.type !== 'file') continue
            const reader = part.stream.getReader()
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              size += value.length
            }
          }
        } finally {
          delivered = size
        }
        return { size }
      }
    }

    const base = await start(Ctrl)
    const file = payload(512 * 1024)
    const body = multipartBody('limit-bnd', 'too big', file.bytes)
    const chunks = slice(body, 16 * 1024)

    const res = await postChunked(`${base}/upload/limited`, 'multipart/form-data; boundary=limit-bnd', chunks)

    // A parsed response at all is the point: the bridge stops reading rather
    // than cancelling the source, because cancelling a `Readable.toWeb` body
    // tears the socket down and the client would see a reset instead of 413.
    // (Node's own client only surfaces the response once it has flushed its
    // request, so `res.sent` says nothing about when the server answered.)
    expect(res.status).toBe(413)
    expect(JSON.parse(res.body)).toMatchObject({ statusCode: 413, details: { limit: 'maxFileSize' } })

    // The handler was cut off at the limit, half a megabyte short of the upload.
    expect(delivered).toBeGreaterThan(0)
    expect(delivered).toBeLessThanOrEqual(maxFileSize)
  })
})
