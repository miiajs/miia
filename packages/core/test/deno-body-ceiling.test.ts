import { describe, expect, it } from 'bun:test'
import { denoListenFetch } from '../src/app/app.js'
import { PayloadTooLargeException } from '../src/exceptions.js'

// listen() wraps the app's fetch with this on Deno only

function chunked(text: string): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  const headers = { 'transfer-encoding': 'chunked' }
  return new Request('http://localhost/upload', { method: 'POST', headers, body, duplex: 'half' } as RequestInit)
}

describe('denoListenFetch - body ceiling (Deno)', () => {
  it('caps a chunked body', async () => {
    const original = chunked('x'.repeat(200))
    let seen: Request | undefined
    const fetch = denoListenFetch(async (req) => {
      seen = req
      const error = await req.text().then(
        () => null,
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(PayloadTooLargeException)
      return new Response(null, { status: 413 })
    }, 100)
    const res = await fetch(original)
    expect(seen).not.toBe(original)
    expect(res.status).toBe(413)
  })

  it('lets a chunked body within the ceiling through', async () => {
    let text = ''
    const fetch = denoListenFetch(async (req) => {
      text = await req.text()
      return new Response('ok')
    }, 100)
    const res = await fetch(chunked('0123456789'))
    expect(res.status).toBe(200)
    expect(text).toBe('0123456789')
  })

  it('hands the app a request with a Content-Length as it is', async () => {
    const req = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-length': '10' },
      body: '0123456789',
    })
    let seen: Request | undefined
    const fetch = denoListenFetch(async (r) => {
      seen = r
      await r.text()
      return new Response('ok')
    }, 5)
    await fetch(req)
    expect(seen).toBe(req)
  })

  it('leaves a GET and a HEAD to the app untouched, their body and headers included', () => {
    for (const method of ['GET', 'HEAD']) {
      const req = new Request('http://localhost/', { method })
      let reads = 0
      for (const key of ['body', 'headers']) {
        Object.defineProperty(req, key, {
          get() {
            reads++
            return null
          },
        })
      }
      const response = new Response('ok')
      expect(denoListenFetch((r) => (r === req ? response : new Response('other')), 100)(req)).toBe(response)
      expect(reads).toBe(0)
    }
  })

  it('hands the app its own fetch without a ceiling', () => {
    const fetch = () => new Response('ok')
    expect(denoListenFetch(fetch, false)).toBe(fetch)
  })
})
