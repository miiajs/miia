import { describe, expect, it } from 'bun:test'
import { BadRequestException } from '@miiajs/core'
import { createPartStream } from '../src/index.js'
import type { FilePart, MultipartOptions } from '../src/index.js'
import {
  buildBody,
  chunkSized,
  chunkedRequest,
  collect,
  deadline,
  eachByte,
  serialize,
  splitAt,
  statusOf,
} from './helpers.js'
import type { Collected } from './helpers.js'

function sampleForm(): FormData {
  const form = new FormData()
  form.append('title', 'hello world')
  form.append('file', new File(['abcdefghij'.repeat(10)], 'a.txt', { type: 'text/plain' }))
  form.append('tag', 'x')
  return form
}

describe('createPartStream - basics', () => {
  it('parses fields and files from a runtime-built request', async () => {
    const req = new Request('http://localhost/upload', { method: 'POST', body: sampleForm() })
    const result = await collect(req)

    expect(result.order).toEqual(['field:title', 'file:file', 'field:tag'])
    expect(result.fields).toEqual([
      { name: 'title', value: 'hello world' },
      { name: 'tag', value: 'x' },
    ])
    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({
      name: 'file',
      filename: 'a.txt',
      mediaType: 'text/plain',
      size: 100,
    })
    expect(result.files[0].text).toBe('abcdefghij'.repeat(10))
  })

  it('emits every part delivered by a single chunk', async () => {
    const { contentType, body } = await serialize(sampleForm())
    const result = await collect(chunkedRequest(contentType, [body]))

    expect(result.order).toEqual(['field:title', 'file:file', 'field:tag'])
    expect(result.files[0].size).toBe(100)
  })

  it('accepts a quoted boundary', async () => {
    const boundary = 'my-boundary-42'
    const body = buildBody(boundary, [
      { headers: ['content-disposition: form-data; name="title"'], body: 'quoted' },
      {
        headers: ['content-disposition: form-data; name="file"; filename="a.txt"', 'content-type: text/plain'],
        body: 'payload',
      },
    ])
    const contentType = `multipart/form-data; boundary="${boundary}"`

    const result = await collect(chunkedRequest(contentType, [body]))
    expect(result.fields).toEqual([{ name: 'title', value: 'quoted' }])
    expect(result.files[0].text).toBe('payload')
  })
})

describe('createPartStream - media type', () => {
  const boundary = 'media-bnd'
  const contentType = `multipart/form-data; boundary=${boundary}`

  function partsOf(parts: Array<{ headers: string[]; body: string }>): Promise<Collected> {
    return collect(chunkedRequest(contentType, [buildBody(boundary, parts)]))
  }

  it('reads the declared media type without its parameters, lower-cased', async () => {
    const result = await partsOf([
      {
        headers: [
          'content-disposition: form-data; name="doc"; filename="a.txt"',
          'content-type: text/plain;charset=utf-8',
        ],
        body: 'x',
      },
      {
        headers: ['content-disposition: form-data; name="pic"; filename="a.png"', 'content-type: IMAGE/PNG'],
        body: 'x',
      },
      {
        headers: [
          'content-disposition: form-data; name="scan"; filename="a.pdf"',
          'content-type:  Application/PDF ; version=1.7',
        ],
        body: 'x',
      },
    ])

    expect(result.files.map((file) => file.mediaType)).toEqual(['text/plain', 'image/png', 'application/pdf'])
  })

  it('defaults a part carrying a filename to application/octet-stream', async () => {
    const result = await partsOf([
      { headers: ['content-disposition: form-data; name="doc"; filename="notes.txt"'], body: 'x' },
      { headers: ['content-disposition: form-data; name="blob"; filename=""'], body: 'x' },
    ])

    // RFC 7578 labels a file body of unknown type `application/octet-stream`.
    // The filename decides that the part is a file; its extension is never
    // consulted, so `notes.txt` is not read as text.
    expect(result.files.map((file) => file.mediaType)).toEqual(['application/octet-stream', 'application/octet-stream'])
  })

  it('leaves a part with neither a filename nor a media type a text/plain field', async () => {
    const result = await partsOf([{ headers: ['content-disposition: form-data; name="note"'], body: 'plain' }])

    // The default for such a part is `text/plain`, not the binary one - which
    // is what keeps it out of the file branch.
    expect(result.files).toEqual([])
    expect(result.fields).toEqual([{ name: 'note', value: 'plain' }])
  })
})

describe('createPartStream - content-disposition parameters', () => {
  const boundary = 'param-bnd'
  const contentType = `multipart/form-data; boundary=${boundary}`

  function partsOf(headers: string[]): Promise<Collected> {
    return collect(chunkedRequest(contentType, [buildBody(boundary, [{ headers, body: 'value' }])]))
  }

  it('keeps a parameter that follows one carrying no value', async () => {
    const result = await partsOf(['content-disposition: form-data; foo; name="hi"'])
    expect(result.fields).toEqual([{ name: 'hi', value: 'value' }])
  })

  it('ignores a valueless parameter at the end', async () => {
    const result = await partsOf(['content-disposition: form-data; name="hi"; foo'])
    expect(result.fields).toEqual([{ name: 'hi', value: 'value' }])
  })

  it('walks past empty parameters', async () => {
    const result = await partsOf(['content-disposition: form-data; ; ; name="hi"'])
    expect(result.fields).toEqual([{ name: 'hi', value: 'value' }])
  })

  it('keeps both parameters of a file part behind a valueless one', async () => {
    const result = await partsOf(['content-disposition: form-data; foo; name="hi"; filename="a.txt"'])
    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({ name: 'hi', filename: 'a.txt', text: 'value' })
  })
})

describe('createPartStream - chunk boundaries', () => {
  it('parses correctly at every possible cut point', async () => {
    const { contentType, body } = await serialize(sampleForm())
    const failures: number[] = []

    for (let i = 1; i < body.length; i++) {
      try {
        const result = await collect(chunkedRequest(contentType, splitAt(body, i)))
        if (result.order.length !== 3 || result.files[0]?.size !== 100) failures.push(i)
      } catch {
        failures.push(i)
      }
    }

    expect(body.length).toBeGreaterThan(400)
    expect(failures).toEqual([])
  })

  it('parses a body delivered one byte at a time', async () => {
    const { contentType, body } = await serialize(sampleForm())
    const result = await collect(chunkedRequest(contentType, eachByte(body)))

    expect(result.order).toEqual(['field:title', 'file:file', 'field:tag'])
    expect(result.files[0].text).toBe('abcdefghij'.repeat(10))
  })

  it('parses a quoted-boundary body at every cut point', async () => {
    const boundary = 'my-boundary-42'
    const body = buildBody(boundary, [
      { headers: ['content-disposition: form-data; name="title"'], body: 'quoted' },
      {
        headers: ['content-disposition: form-data; name="file"; filename="a.txt"', 'content-type: text/plain'],
        body: 'payload',
      },
    ])
    const contentType = `multipart/form-data; boundary="${boundary}"`
    const failures: number[] = []

    for (let i = 1; i < body.length; i++) {
      try {
        const result = await collect(chunkedRequest(contentType, splitAt(body, i)))
        if (result.fields.length !== 1 || result.files[0]?.text !== 'payload') failures.push(i)
      } catch {
        failures.push(i)
      }
    }

    expect(failures).toEqual([])
  })
})

describe('createPartStream - iteration control', () => {
  it('does not deadlock when every part is skipped', async () => {
    const { contentType, body } = await serialize(sampleForm())
    let seen = 0

    for await (const _part of createPartStream(chunkedRequest(contentType, chunkSized(body, 16)))) {
      seen++
    }

    expect(seen).toBe(3)
  })

  it('does not hang on a form without files', async () => {
    const form = new FormData()
    form.append('a', '1')
    form.append('b', '2')
    form.append('c', '3')
    const { contentType, body } = await serialize(form)

    const result = await collect(chunkedRequest(contentType, chunkSized(body, 8)))
    expect(result.fields).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'c', value: '3' },
    ])
    expect(result.files).toEqual([])
  })

  it('stops the parse on break', async () => {
    const { contentType, body } = await serialize(sampleForm())
    const iterator = createPartStream(chunkedRequest(contentType, chunkSized(body, 16)))

    const seen: string[] = []
    for await (const part of iterator) {
      seen.push(part.name)
      break
    }

    expect(seen).toEqual(['title'])
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })

  it('errors an abandoned part instead of handing over truncated bytes', async () => {
    const form = new FormData()
    form.append('file', new File(['x'.repeat(4000)], 'big.txt', { type: 'text/plain' }))
    form.append('after', 'done')
    const { contentType, body } = await serialize(form)

    const iterator = createPartStream(chunkedRequest(contentType, chunkSized(body, 64)))
    const first = await iterator.next()
    const part = first.value as FilePart
    expect(part.type).toBe('file')

    const second = await iterator.next()
    expect(second.value).toMatchObject({ type: 'field', name: 'after', value: 'done' })

    await expect(part.bytes()).rejects.toThrow(/abandoned/)
  })

  it('errors an abandoned part whose bytes had all arrived already', async () => {
    // The chunking is what makes this different from the test above: delivered
    // whole, the part is complete inside its stream's own queue by the time the
    // iterator moves on. It has to be errored anyway, or the contract would
    // hold for a 4000-byte upload and quietly not hold for a 200-byte one.
    for (const size of [10, 200, 4000, 20000]) {
      const form = new FormData()
      form.append('file', new File(['x'.repeat(size)], 'small.txt', { type: 'text/plain' }))
      form.append('after', 'done')
      const { contentType, body } = await serialize(form)

      const iterator = createPartStream(chunkedRequest(contentType, [body]))
      const part = (await iterator.next()).value as FilePart
      expect(part.type).toBe('file')
      await iterator.next()

      await expect(part.bytes()).rejects.toThrow(/abandoned/)
    }
  })

  it('leaves a part the consumer read to the end alone', async () => {
    const form = new FormData()
    form.append('file', new File(['x'.repeat(200)], 'small.txt', { type: 'text/plain' }))
    form.append('after', 'done')
    const { contentType, body } = await serialize(form)

    const iterator = createPartStream(chunkedRequest(contentType, [body]))
    const part = (await iterator.next()).value as FilePart
    const bytes = await part.bytes()
    expect(bytes.length).toBe(200)

    // Advancing must not retroactively spoil what was already handed over.
    await iterator.next()
    expect(await part.bytes()).toBe(bytes)
  })

  it('refuses a second next() while the first is still in flight', async () => {
    const form = new FormData()
    form.append('file', new File(['x'.repeat(300)], 'a.txt', { type: 'text/plain' }))
    form.append('after', 'done')
    const { contentType, body } = await serialize(form)
    const iterator = createPartStream(chunkedRequest(contentType, chunkSized(body, 16)))

    // Both would wait on the same gate while the part the first one took keeps
    // the reading loop from asking for more - a deadlock, before the refusal.
    const settled = await deadline(
      Promise.allSettled([iterator.next(), iterator.next()]),
      1000,
      'two concurrent next() calls',
    )
    expect(settled.map((entry) => entry.status)).toEqual(['fulfilled', 'rejected'])
    expect((settled[1] as PromiseRejectedResult).reason.message).toMatch(/one at a time/)

    const after = await deadline(iterator.next(), 1000, 'the part after the refusal')
    expect(after.value).toMatchObject({ type: 'field', name: 'after', value: 'done' })
  })

  it('hands the same bytes to a second bytes() call', async () => {
    const form = new FormData()
    form.append('file', new File(['payload'], 'a.txt', { type: 'text/plain' }))
    const { contentType, body } = await serialize(form)
    const iterator = createPartStream(chunkedRequest(contentType, chunkSized(body, 16)))

    const part = (await iterator.next()).value as FilePart
    const first = await part.bytes()
    const second = await deadline(part.bytes(), 1000, 'the second bytes() call')

    expect(new TextDecoder().decode(first)).toBe('payload')
    expect(second).toBe(first)
  })

  it('reads the source only as far as the consumer has drained it', async () => {
    const form = new FormData()
    form.append('title', 'hi')
    form.append('file', new File(['q'.repeat(20000)], 'big.txt', { type: 'text/plain' }))
    const { contentType, body } = await serialize(form)
    const chunks = chunkSized(body, 256)

    let pulled = 0
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(chunks[pulled++])
      },
    })
    const req = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: source,
      duplex: 'half',
    } as RequestInit)

    const iterator = createPartStream(req)
    await iterator.next()
    const file = (await iterator.next()).value as FilePart

    const reader = file.stream.getReader()
    let total = 0
    for (let i = 0; i < 3; i++) {
      const { value } = await reader.read()
      total += (value as Uint8Array).length
    }
    expect(pulled).toBeLessThan(chunks.length / 4)

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += (value as Uint8Array).length
    }
    expect(total).toBe(20000)
    expect(pulled).toBe(chunks.length)
  })
})

describe('createPartStream - limits', () => {
  it('rejects a file that outgrows maxFileSize mid-stream', async () => {
    const form = new FormData()
    form.append('file', new File(['x'.repeat(4000)], 'big.txt', { type: 'text/plain' }))
    const { contentType, body } = await serialize(form)

    const result = await statusOf(collect(chunkedRequest(contentType, chunkSized(body, 64)), { maxFileSize: 500 }))
    expect(result).toEqual({ statusCode: 413, limit: 'maxFileSize' })
  })

  it('rejects more files than maxFiles', async () => {
    const form = new FormData()
    form.append('a', new File(['one'], 'a.txt', { type: 'text/plain' }))
    form.append('b', new File(['two'], 'b.txt', { type: 'text/plain' }))
    const { contentType, body } = await serialize(form)

    const result = await statusOf(collect(chunkedRequest(contentType, [body]), { maxFiles: 1 }))
    expect(result).toEqual({ statusCode: 413, limit: 'maxFiles' })
  })

  it('rejects more fields than maxFields', async () => {
    const form = new FormData()
    form.append('a', '1')
    form.append('b', '2')
    form.append('c', '3')
    const { contentType, body } = await serialize(form)

    const result = await statusOf(collect(chunkedRequest(contentType, [body]), { maxFields: 2 }))
    expect(result).toEqual({ statusCode: 413, limit: 'maxFields' })
  })

  it('rejects a field value over maxFieldSize', async () => {
    const form = new FormData()
    form.append('bio', 'y'.repeat(2000))
    const { contentType, body } = await serialize(form)

    const result = await statusOf(collect(chunkedRequest(contentType, [body]), { maxFieldSize: 100 }))
    expect(result).toEqual({ statusCode: 413, limit: 'maxFieldSize' })
  })

  it('rejects a part name over maxFieldNameSize', async () => {
    const form = new FormData()
    form.append('a-really-long-field-name', '1')
    const { contentType, body } = await serialize(form)

    const result = await statusOf(collect(chunkedRequest(contentType, [body]), { maxFieldNameSize: 5 }))
    expect(result).toEqual({ statusCode: 413, limit: 'maxFieldNameSize' })
  })

  it('measures maxFieldNameSize on the name the bridge read, not the one the engine lost', async () => {
    const boundary = 'name-bnd'
    const body = buildBody(boundary, [
      { headers: ['content-disposition: form-data; name="довжелезна-назва"'], body: 'x' },
    ])

    const result = await statusOf(
      collect(chunkedRequest(`multipart/form-data; boundary=${boundary}`, [body]), { maxFieldNameSize: 5 }),
    )
    expect(result).toEqual({ statusCode: 413, limit: 'maxFieldNameSize' })
  })

  it('rejects a body over an explicit bodyLimit', async () => {
    const form = new FormData()
    form.append('file', new File(['z'.repeat(2000)], 'big.txt', { type: 'text/plain' }))
    const { contentType, body } = await serialize(form)

    const result = await statusOf(collect(chunkedRequest(contentType, chunkSized(body, 256)), { bodyLimit: 500 }))
    expect(result).toEqual({ statusCode: 413, limit: 'bodyLimit' })
  })

  it('accepts a valid form with several text fields under a file limit', async () => {
    const form = new FormData()
    form.append('one', 'a'.repeat(300))
    form.append('two', 'b'.repeat(300))
    form.append('three', 'c'.repeat(300))
    form.append('file', new File(['d'.repeat(100)], 'small.txt', { type: 'text/plain' }))
    const { contentType, body } = await serialize(form)

    const result = await collect(chunkedRequest(contentType, chunkSized(body, 64)), { maxFileSize: 1000, maxFiles: 1 })
    expect(result.fields.map((f) => f.value.length)).toEqual([300, 300, 300])
    expect(result.files[0].size).toBe(100)
  })

  it('does not count a zero-byte file input against maxFiles', async () => {
    const boundary = 'zero-bnd'
    const body = buildBody(boundary, [
      { headers: ['content-disposition: form-data; name="avatar"; filename=""'], body: '' },
      {
        headers: ['content-disposition: form-data; name="doc"; filename="doc.txt"', 'content-type: text/plain'],
        body: 'real',
      },
    ])

    const result = await collect(chunkedRequest(`multipart/form-data; boundary=${boundary}`, [body]), { maxFiles: 1 })
    expect(result.files.map((f) => f.size)).toEqual([0, 4])
  })
})

describe('createPartStream - allowedTypes', () => {
  const boundary = 'allow-bnd'
  const contentType = `multipart/form-data; boundary=${boundary}`

  function partsOf(parts: Array<{ headers: string[]; body: string }>, options?: MultipartOptions): Promise<Collected> {
    return collect(chunkedRequest(contentType, [buildBody(boundary, parts)]), options)
  }

  function file(name: string, filename: string, headers: string[] = []): { headers: string[]; body: string } {
    return {
      headers: [`content-disposition: form-data; name="${name}"; filename="${filename}"`, ...headers],
      body: 'x',
    }
  }

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; details: unknown }> {
    try {
      await promise
    } catch (error) {
      const err = error as { statusCode: number; details: unknown }
      return { statusCode: err.statusCode, details: err.details }
    }
    throw new Error('expected the promise to reject')
  }

  it('lets an exactly listed media type through', async () => {
    const result = await partsOf([file('pic', 'a.png', ['content-type: image/png'])], { allowedTypes: ['image/png'] })
    expect(result.files.map((entry) => entry.mediaType)).toEqual(['image/png'])
  })

  it('answers 415 with the media type and the list', async () => {
    const result = await refusal(
      partsOf([file('scan', 'a.pdf', ['content-type: application/pdf'])], { allowedTypes: ['image/png'] }),
    )
    expect(result).toEqual({ statusCode: 415, details: { mediaType: 'application/pdf', allowed: ['image/png'] } })
  })

  it('matches a subtype wildcard', async () => {
    const passed = await partsOf([file('pic', 'a.png', ['content-type: image/png'])], { allowedTypes: ['image/*'] })
    expect(passed.files.map((entry) => entry.mediaType)).toEqual(['image/png'])

    const rejected = await refusal(
      partsOf([file('scan', 'a.pdf', ['content-type: application/pdf'])], { allowedTypes: ['image/*'] }),
    )
    expect(rejected.statusCode).toBe(415)
  })

  it('ignores case in the list and in the header', async () => {
    const result = await partsOf([file('pic', 'a.png', ['content-type: IMAGE/PNG'])], {
      allowedTypes: [' Image/PNG '],
    })
    expect(result.files.map((entry) => entry.mediaType)).toEqual(['image/png'])
  })

  it('lets anything through on */*', async () => {
    const result = await partsOf([file('scan', 'a.pdf', ['content-type: application/pdf']), file('blob', 'a.bin')], {
      allowedTypes: ['*/*'],
    })
    expect(result.files.map((entry) => entry.mediaType)).toEqual(['application/pdf', 'application/octet-stream'])
  })

  it('compares a file that declares no media type as application/octet-stream', async () => {
    const passed = await partsOf([file('blob', 'a.bin')], { allowedTypes: ['application/octet-stream'] })
    expect(passed.files.map((entry) => entry.mediaType)).toEqual(['application/octet-stream'])

    const rejected = await refusal(partsOf([file('blob', 'a.bin')], { allowedTypes: ['image/*'] }))
    expect(rejected).toEqual({
      statusCode: 415,
      details: { mediaType: 'application/octet-stream', allowed: ['image/*'] },
    })
  })

  it('leaves text fields alone', async () => {
    const result = await partsOf(
      [
        { headers: ['content-disposition: form-data; name="title"'], body: 'invoice' },
        { headers: ['content-disposition: form-data; name="note"', 'content-type: text/plain'], body: 'hello' },
        file('pic', 'a.png', ['content-type: image/png']),
      ],
      { allowedTypes: ['image/png'] },
    )

    expect(result.fields).toEqual([
      { name: 'title', value: 'invoice' },
      { name: 'note', value: 'hello' },
    ])
    expect(result.files).toHaveLength(1)
  })

  it('refuses the part before its body is read', async () => {
    const form = new FormData()
    form.append('title', 'hi')
    form.append('file', new File(['q'.repeat(20000)], 'big.pdf', { type: 'application/pdf' }))
    const { contentType: formType, body } = await serialize(form)
    const chunks = chunkSized(body, 256)

    let pulled = 0
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(chunks[pulled++])
      },
    })
    const req = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': formType },
      body: source,
      duplex: 'half',
    } as RequestInit)

    const result = await refusal(collect(req, { allowedTypes: ['image/*'] }))
    expect(result.statusCode).toBe(415)
    // The refusal lands on the part header, so the 20 KB body never travels.
    expect(pulled).toBeLessThan(chunks.length / 4)
  })
})

describe('createPartStream - malformed input', () => {
  it('rejects a non form-data media type before any read', () => {
    const req = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/mixed; boundary=abc' },
      body: 'noop',
    })

    expect(() => createPartStream(req)).toThrow(BadRequestException)
  })

  it('rejects a missing boundary before any read', () => {
    const req = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data' },
      body: 'noop',
    })

    expect(() => createPartStream(req)).toThrow(BadRequestException)
  })

  it('rejects an empty body', async () => {
    const req = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=abc' },
    })

    expect(await statusOf(collect(req))).toEqual({ statusCode: 400, limit: undefined })
  })

  it('rejects a truncated body', async () => {
    const { contentType, body } = await serialize(sampleForm())
    const truncated = body.subarray(0, body.length - 40)

    expect(await statusOf(collect(chunkedRequest(contentType, chunkSized(truncated, 64))))).toEqual({
      statusCode: 400,
      limit: undefined,
    })
  })

  it('rejects a part that declares no content-disposition at all', async () => {
    // The engine only refuses an unnamed part when it read `form-data` out of
    // the disposition, so this one reaches the bridge as a field named ''.
    const body = buildBody('anon-bnd', [{ headers: ['content-type: text/plain'], body: 'value' }])
    const req = chunkedRequest('multipart/form-data; boundary=anon-bnd', [body])

    await expect(collect(req)).rejects.toThrow(/missing a name/)
  })
})

/**
 * multipasta 0.2.8 decodes an RFC 5987 `filename*` with `decodeURIComponent`
 * inside `write()`, so a malformed one throws straight out of the parser -
 * under a reading loop nothing awaits. Left unlatched it hung the request for
 * good and took the process down with an unhandled rejection.
 */
describe('createPartStream - a throw out of the parser', () => {
  const boundary = 'throw-bnd'
  const contentType = `multipart/form-data; boundary=${boundary}`

  function malformed(payload: string): Uint8Array {
    return buildBody(boundary, [
      { headers: ['content-disposition: form-data; name="f"; filename*=UTF-8\'\'%%%'], body: payload },
    ])
  }

  it('answers 400 instead of hanging the request', async () => {
    const req = chunkedRequest(contentType, [malformed('payload')])

    expect(await statusOf(deadline(collect(req), 1000, 'a malformed filename*'))).toEqual({
      statusCode: 400,
      limit: undefined,
    })
    // The throw lands on the same latch as any other failure, so the source is
    // let go of instead of being held by a reader nobody will ever release.
    expect(req.body?.locked).toBe(false)
  })

  it('answers 400 when the throw lands mid-stream rather than on the tail', async () => {
    const req = chunkedRequest(contentType, chunkSized(malformed('x'.repeat(4000)), 64))

    expect(await statusOf(deadline(collect(req), 1000, 'a malformed filename* mid-stream'))).toEqual({
      statusCode: 400,
      limit: undefined,
    })
  })

  it('leaves no unhandled rejection behind', async () => {
    const seen: unknown[] = []
    const record = (reason: unknown): void => {
      seen.push(reason)
    }

    process.on('unhandledRejection', record)
    try {
      await statusOf(deadline(collect(chunkedRequest(contentType, [malformed('payload')])), 1000, 'the request'))
      await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
      process.off('unhandledRejection', record)
    }

    expect(seen).toEqual([])
  })
})
