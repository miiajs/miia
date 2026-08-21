import { describe, expect, it } from 'bun:test'
import { BodyLimit, Controller, Miia, Module, Post, ValidateParams } from '@miiajs/core'
import type { Constructor, ZodLike, ZodLikeIssue } from '@miiajs/core'
import { Multipart, ValidateForm } from '../src/index.js'
import type { MultipartContext } from '../src/index.js'
import { buildBody, chunkedRequest, serialize } from './helpers.js'

const decoder = new TextDecoder()

function bootstrap(...controllers: Constructor[]): Miia {
  @Module({ controllers })
  class TestModule {}

  return new Miia({ logger: false }).register(TestModule)
}

/** Posts a runtime-serialized form. Constructed Requests carry no Content-Length, so we set it. */
async function postForm(app: Miia, path: string, form: FormData): Promise<Response> {
  const { contentType, body } = await serialize(form)
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': contentType, 'content-length': String(body.byteLength) },
      body: body as Uint8Array<ArrayBuffer>,
    }),
  )
}

describe('@Multipart - ctx.parts', () => {
  it('streams fields and files to the handler', async () => {
    @Controller('/upload')
    class Ctrl {
      @Post('/stream')
      @Multipart()
      async stream(ctx: MultipartContext) {
        const seen: string[] = []
        for await (const part of ctx.parts) {
          if (part.type === 'field') seen.push(`field:${part.name}=${part.value}`)
          else seen.push(`file:${part.name}:${part.filename}:${decoder.decode(await part.bytes())}`)
        }
        return { seen }
      }
    }

    const form = new FormData()
    form.append('title', 'hello')
    form.append('doc', new File(['payload'], 'a.txt', { type: 'text/plain' }))

    const res = await postForm(bootstrap(Ctrl), '/upload/stream', form)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ seen: ['field:title=hello', 'file:doc:a.txt:payload'] })
  })

  it('discards what the handler left unread', async () => {
    @Controller('/upload')
    class Ctrl {
      @Post('/first')
      @Multipart()
      async first(ctx: MultipartContext) {
        for await (const part of ctx.parts) {
          if (part.type === 'field') return { first: part.value }
        }
        return { first: null }
      }

      @Post('/ignored')
      @Multipart()
      ignored() {
        return { ok: true }
      }
    }

    const app = bootstrap(Ctrl)
    const form = (): FormData => {
      const data = new FormData()
      data.append('title', 'hello')
      data.append('doc', new File(['payload'], 'a.txt', { type: 'text/plain' }))
      return data
    }

    const partial = await postForm(app, '/upload/first', form())
    expect(partial.status).toBe(200)
    expect(await partial.json()).toEqual({ first: 'hello' })

    const untouched = await postForm(app, '/upload/ignored', form())
    expect(untouched.status).toBe(200)
    expect(await untouched.json()).toEqual({ ok: true })
  })

  it('rejects a non-multipart/form-data body before the handler runs', async () => {
    let handlerRan = false

    @Controller('/upload')
    class Ctrl {
      @Post('/mixed')
      @Multipart()
      mixed() {
        handlerRan = true
        return { ok: true }
      }
    }

    const body = buildBody('bnd', [{ headers: ['content-disposition: form-data; name="a"'], body: 'x' }])
    const res = await bootstrap(Ctrl).fetch(
      new Request('http://localhost/upload/mixed', {
        method: 'POST',
        headers: { 'content-type': 'multipart/mixed; boundary=bnd', 'content-length': String(body.byteLength) },
        body: body as Uint8Array<ArrayBuffer>,
      }),
    )

    expect(res.status).toBe(400)
    expect(handlerRan).toBe(false)
  })
})

describe('@Multipart - ctx.form()', () => {
  it('buffers files and fields, last value wins per field name', async () => {
    @Controller('/upload')
    class Ctrl {
      @Post('/form')
      @Multipart()
      async form(ctx: MultipartContext) {
        const first = ctx.form()
        const second = ctx.form()
        const result = await first
        return {
          cached: first === second,
          fields: result.fields,
          docs: await Promise.all(result.files.doc.map(async (file) => ({ name: file.name, text: await file.text() }))),
        }
      }
    }

    const form = new FormData()
    form.append('title', 'first')
    form.append('title', 'second')
    form.append('doc', new File(['one'], 'a.txt', { type: 'text/plain' }))
    form.append('doc', new File(['two'], 'b.txt', { type: 'text/plain' }))

    const res = await postForm(bootstrap(Ctrl), '/upload/form', form)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      cached: true,
      fields: { title: 'second' },
      docs: [
        { name: 'a.txt', text: 'one' },
        { name: 'b.txt', text: 'two' },
      ],
    })
  })

  it('leaves an empty file input out of files while ctx.parts still sees it', async () => {
    @Controller('/upload')
    class Ctrl {
      @Post('/form')
      @Multipart()
      async form(ctx: MultipartContext) {
        const { files, fields } = await ctx.form()
        return { fileNames: Object.keys(files), fields }
      }

      @Post('/stream')
      @Multipart()
      async stream(ctx: MultipartContext) {
        const seen: Array<{ name: string; filename?: string; size: number }> = []
        for await (const part of ctx.parts) {
          if (part.type === 'file')
            seen.push({ name: part.name, filename: part.filename, size: (await part.bytes()).length })
        }
        return { seen }
      }
    }

    const app = bootstrap(Ctrl)
    const emptyInput = (): FormData => {
      const form = new FormData()
      form.append('title', 'x')
      form.append('avatar', new File([], '', { type: 'application/octet-stream' }))
      return form
    }

    const buffered = await postForm(app, '/upload/form', emptyInput())
    expect(buffered.status).toBe(200)
    expect(await buffered.json()).toEqual({ fileNames: [], fields: { title: 'x' } })

    const streamed = await postForm(app, '/upload/stream', emptyInput())
    expect(streamed.status).toBe(200)
    expect(await streamed.json()).toEqual({ seen: [{ name: 'avatar', filename: '', size: 0 }] })
  })
})

describe('@Multipart - body budget', () => {
  it('derives the route body limit from maxFileSize * maxFiles + fieldsBudget', async () => {
    let handlerRan = false

    @Controller('/upload')
    class Ctrl {
      @Post('/derived')
      @Multipart({ maxFileSize: 1024, maxFiles: 1, fieldsBudget: 1024 })
      async derived(ctx: MultipartContext) {
        handlerRan = true
        const { fields } = await ctx.form()
        return { fields }
      }
    }

    const app = bootstrap(Ctrl)

    const small = new FormData()
    small.append('title', 'ok')
    const accepted = await postForm(app, '/upload/derived', small)
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toEqual({ fields: { title: 'ok' } })

    handlerRan = false
    const big = new FormData()
    big.append('doc', new File(['x'.repeat(4000)], 'a.txt', { type: 'text/plain' }))
    const rejected = await postForm(app, '/upload/derived', big)
    expect(rejected.status).toBe(413)
    expect((await rejected.json()).message).toContain('2048 byte limit')
    expect(handlerRan).toBe(false)
  })

  it('falls back to the route @BodyLimit as the multipart budget', async () => {
    @Controller('/upload')
    class Ctrl {
      @Post('/budget')
      @BodyLimit(400)
      @Multipart()
      async budget(ctx: MultipartContext) {
        const seen: string[] = []
        for await (const part of ctx.parts) {
          if (part.type === 'field') seen.push(`${part.name}=${part.value}`)
          else seen.push(`${part.name}:${(await part.bytes()).length}`)
        }
        return { seen }
      }
    }

    const app = bootstrap(Ctrl)
    const contentType = 'multipart/form-data; boundary=bnd'
    const field = (value: string) => ({ headers: ['content-disposition: form-data; name="title"'], body: value })

    // Chunked bodies carry no Content-Length, so the router's check cannot fire
    // and only the parser's maxTotalSize can reject the request.
    const under = await app.fetch(chunkedRequest(contentType, [buildBody('bnd', [field('small')])], '/upload/budget'))
    expect(under.status).toBe(200)
    expect(await under.json()).toEqual({ seen: ['title=small'] })

    const over = await app.fetch(
      chunkedRequest(contentType, [buildBody('bnd', [field('x'.repeat(2000))])], '/upload/budget'),
    )
    expect(over.status).toBe(413)
    expect((await over.json()).details).toEqual({ limit: 'bodyLimit' })
  })
})

describe('@Multipart - allowedTypes', () => {
  let seenFiles: string[] = []

  @Controller('/upload')
  class Ctrl {
    @Post('/stream')
    @Multipart({ allowedTypes: ['image/*'] })
    async stream(ctx: MultipartContext) {
      for await (const part of ctx.parts) {
        if (part.type === 'file') seenFiles.push(part.mediaType)
      }
      return { seen: seenFiles }
    }

    @Post('/form')
    @Multipart({ allowedTypes: ['image/*'] })
    async form(ctx: MultipartContext) {
      const { files } = await ctx.form()
      seenFiles = Object.values(files).flatMap((group) => group.map((entry) => entry.type))
      return { seen: seenFiles }
    }
  }

  function upload(mediaType: string, filename: string): FormData {
    const form = new FormData()
    form.append('title', 'invoice')
    form.append('doc', new File(['payload'], filename, { type: mediaType }))
    return form
  }

  it('rejects a file outside the list with 415 on both paths', async () => {
    const app = bootstrap(Ctrl)

    for (const path of ['/upload/stream', '/upload/form']) {
      seenFiles = []
      const res = await postForm(app, path, upload('application/pdf', 'a.pdf'))
      expect(res.status).toBe(415)
      expect(await res.json()).toMatchObject({
        statusCode: 415,
        details: { mediaType: 'application/pdf', allowed: ['image/*'] },
      })
      expect(seenFiles).toEqual([])
    }
  })

  it('passes a listed file through on both paths', async () => {
    const app = bootstrap(Ctrl)

    for (const path of ['/upload/stream', '/upload/form']) {
      seenFiles = []
      const res = await postForm(app, path, upload('image/png', 'a.png'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ seen: ['image/png'] })
    }
  })
})

describe('@Multipart - decorator order', () => {
  const idSchema: ZodLike = {
    safeParse(data: unknown) {
      const params = data as Record<string, string>
      if (!/^\d+$/.test(params.id)) {
        return { success: false as const, error: { issues: [{ message: 'id must be numeric', path: ['id'] }] } }
      }
      return { success: true as const, data: { ...params, id: Number(params.id) } }
    },
  }

  @Controller('/orders')
  class Ctrl {
    @Post('/:id/above')
    @Multipart()
    @ValidateParams(idSchema)
    above(ctx: MultipartContext) {
      return read(ctx)
    }

    @Post('/:id/below')
    @ValidateParams(idSchema)
    @Multipart()
    below(ctx: MultipartContext) {
      return read(ctx)
    }
  }

  async function read(ctx: MultipartContext) {
    const { fields, files } = await ctx.form()
    return { id: ctx.params.id, title: fields.title, doc: await files.doc[0].text() }
  }

  function attachment(): FormData {
    const form = new FormData()
    form.append('title', 'invoice')
    form.append('doc', new File(['payload'], 'a.txt', { type: 'text/plain' }))
    return form
  }

  it('parses the same way whichever decorator is applied first', async () => {
    const app = bootstrap(Ctrl)
    const expected = { id: 42, title: 'invoice', doc: 'payload' }

    const above = await postForm(app, '/orders/42/above', attachment())
    expect(above.status).toBe(200)
    expect(await above.json()).toEqual(expected)

    const below = await postForm(app, '/orders/42/below', attachment())
    expect(below.status).toBe(200)
    expect(await below.json()).toEqual(expected)
  })

  it('still rejects invalid params in both orders', async () => {
    const app = bootstrap(Ctrl)

    expect((await postForm(app, '/orders/abc/above', attachment())).status).toBe(422)
    expect((await postForm(app, '/orders/abc/below', attachment())).status).toBe(422)
  })
})

describe('@ValidateForm', () => {
  interface Upload {
    title: string
    doc: File
  }

  const uploadSchema: ZodLike = {
    safeParse(data: unknown) {
      const form = data as Record<string, unknown>
      const issues: ZodLikeIssue[] = []
      if (typeof form.title !== 'string') issues.push({ message: 'title must be a string', path: ['title'] })
      if (!(form.doc instanceof File)) issues.push({ message: 'doc must be a file', path: ['doc'] })
      if (issues.length > 0) return { success: false as const, error: { issues } }
      return { success: true as const, data: { title: (form.title as string).toUpperCase(), doc: form.doc as File } }
    },
  }

  const docsSchema: ZodLike = {
    safeParse(data: unknown) {
      const { docs } = data as Record<string, unknown>
      if (!Array.isArray(docs) || docs.some((entry) => !(entry instanceof File))) {
        return { success: false as const, error: { issues: [{ message: 'docs must be files', path: ['docs'] }] } }
      }
      return { success: true as const, data: { docs: docs as File[] } }
    },
  }

  @Controller('/upload')
  class Ctrl {
    @Post('/above')
    @ValidateForm(uploadSchema)
    @Multipart()
    above(ctx: MultipartContext) {
      return describeUpload(ctx)
    }

    @Post('/below')
    @Multipart()
    @ValidateForm(uploadSchema)
    below(ctx: MultipartContext) {
      return describeUpload(ctx)
    }

    @Post('/docs')
    @Multipart()
    @ValidateForm(docsSchema)
    async docs(ctx: MultipartContext) {
      const { docs } = await ctx.form<{ docs: File[] }>()
      return { count: docs.length, names: docs.map((file) => file.name) }
    }
  }

  async function describeUpload(ctx: MultipartContext) {
    const { title, doc } = await ctx.form<Upload>()
    return { title, doc: { name: doc.name, text: await doc.text() } }
  }

  function attachment(): FormData {
    const form = new FormData()
    form.append('title', 'invoice')
    form.append('doc', new File(['payload'], 'a.txt', { type: 'text/plain' }))
    return form
  }

  function titleOnly(): FormData {
    const form = new FormData()
    form.append('title', 'invoice')
    return form
  }

  it('validates fields and files as one flat object', async () => {
    const res = await postForm(bootstrap(Ctrl), '/upload/below', attachment())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ title: 'INVOICE', doc: { name: 'a.txt', text: 'payload' } })
  })

  it('answers 422 with the schema issues', async () => {
    const res = await postForm(bootstrap(Ctrl), '/upload/below', titleOnly())
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Form validation failed',
      details: [{ message: 'doc must be a file', path: ['doc'] }],
    })
  })

  it('groups a repeated file name into an array', async () => {
    const form = new FormData()
    form.append('docs', new File(['one'], 'a.txt', { type: 'text/plain' }))
    form.append('docs', new File(['two'], 'b.txt', { type: 'text/plain' }))

    const res = await postForm(bootstrap(Ctrl), '/upload/docs', form)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 2, names: ['a.txt', 'b.txt'] })
  })

  it('behaves the same above and below @Multipart', async () => {
    const app = bootstrap(Ctrl)
    const expected = { title: 'INVOICE', doc: { name: 'a.txt', text: 'payload' } }

    const above = await postForm(app, '/upload/above', attachment())
    expect(above.status).toBe(200)
    expect(await above.json()).toEqual(expected)

    const below = await postForm(app, '/upload/below', attachment())
    expect(below.status).toBe(200)
    expect(await below.json()).toEqual(expected)

    expect((await postForm(app, '/upload/above', titleOnly())).status).toBe(422)
    expect((await postForm(app, '/upload/below', titleOnly())).status).toBe(422)
  })

  it('reports a route missing @Multipart', async () => {
    @Controller('/upload')
    class Bare {
      @Post('/bare')
      @ValidateForm(uploadSchema)
      bare() {
        return { ok: true }
      }
    }

    let captured: unknown
    const app = bootstrap(Bare).use(async (_ctx, next) => {
      try {
        await next()
      } catch (error) {
        captured = error
        throw error
      }
    })

    const res = await postForm(app, '/upload/bare', attachment())
    expect(res.status).toBe(500)
    expect((captured as Error).message).toBe(
      '@ValidateForm on "bare" needs @Multipart on the same method - there is no form to validate',
    )
  })
})

describe('decorator metadata', () => {
  const passthrough: ZodLike = { safeParse: (data: unknown) => ({ success: true as const, data }) }
  const fakeContext = (name: string) =>
    ({
      kind: 'method',
      name,
      static: false,
      private: false,
      metadata: undefined,
    }) as unknown as ClassMethodDecoratorContext

  it('names the missing polyfill instead of failing inside a metadata write', () => {
    expect(() => Multipart({})(() => {}, fakeContext('upload'))).toThrow(/@Multipart cannot read decorator metadata/)
    expect(() => ValidateForm(passthrough)(() => {}, fakeContext('upload'))).toThrow(
      /@ValidateForm cannot read decorator metadata/,
    )
  })
})
