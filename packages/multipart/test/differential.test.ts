import { describe, expect, it } from 'bun:test'
import { collectForm } from '../src/form.js'
import { createPartStream } from '../src/index.js'
import { buildBody, chunkSized, chunkedRequest, eachByte, serialize, splitAt } from './helpers.js'

/**
 * Differential tests: every body in the corpus is parsed by the bridge at many
 * chunk splits and compared against a reference parser, part for part.
 *
 * The oracle is swappable on purpose. Today it is the runtime's own
 * `formData()`, which validates the bridge against multipasta; the day the
 * bridge grows its own parser, `reference()` becomes multipasta and the same
 * corpus checks the new parser against the old engine.
 */

// ─── Normalized parts ────────────────────────────────────────────

interface NormalizedPart {
  kind: 'field' | 'file'
  name: string
  value?: string
  /** File name, `''` when the part declares an empty one. */
  filename?: string
  /** Media type without parameters - see the divergence tests below. */
  mediaType?: string
  /** `<length>:<fnv1a>` of the file payload. */
  digest?: string
}

function digest(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${bytes.length}:${hash.toString(16)}`
}

function mediaTypeOf(value: string): string {
  const semi = value.indexOf(';')
  return (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase()
}

function nativeForm(body: Uint8Array, contentType: string): Promise<FormData> {
  return new Response(body as Uint8Array<ArrayBuffer>, { headers: { 'content-type': contentType } }).formData()
}

/** The oracle. Replace the body of this function to diff against another parser. */
async function reference(body: Uint8Array, contentType: string): Promise<NormalizedPart[]> {
  const form = await nativeForm(body, contentType)

  const parts: NormalizedPart[] = []
  for (const [name, entry] of form.entries()) {
    // The ambient `FormData` types this as a string; a file entry is a `File`.
    const value = entry as string | File
    if (typeof value === 'string') {
      parts.push({ kind: 'field', name, value })
      continue
    }
    parts.push({
      kind: 'file',
      name,
      filename: value.name,
      mediaType: mediaTypeOf(value.type),
      digest: digest(new Uint8Array(await value.arrayBuffer())),
    })
  }
  return parts
}

/** The subject: our bridge, fed the body in the given chunks. */
async function subject(chunks: Uint8Array[], contentType: string): Promise<NormalizedPart[]> {
  const parts: NormalizedPart[] = []
  for await (const part of createPartStream(chunkedRequest(contentType, chunks))) {
    if (part.type === 'field') {
      parts.push({ kind: 'field', name: part.name, value: part.value })
      continue
    }
    const bytes = await part.bytes()
    parts.push({
      kind: 'file',
      name: part.name,
      filename: part.filename,
      mediaType: part.mediaType,
      digest: digest(bytes),
    })
  }
  return parts
}

/**
 * Two axes the oracle cannot settle, both pinned by their own tests below:
 * Bun's `formData()` derives `File.type` from the filename extension alone -
 * the part's `Content-Type` never reaches it, so an extensionless filename
 * comes back with no media type whatever the part declared - and it hands back
 * a zero-length part with no `name` at all.
 */
function comparable(parts: NormalizedPart[]): NormalizedPart[] {
  return parts.map((part) => {
    if (part.kind !== 'file') return part
    const { mediaType: _mediaType, filename, ...rest } = part
    return part.digest?.startsWith('0:') ? rest : { ...rest, filename }
  })
}

// ─── Corpus ──────────────────────────────────────────────────────

interface Body {
  label: string
  contentType: string
  bytes: Uint8Array
}

function file(name: string, filename: string, mediaType: string, body: string): { headers: string[]; body: string } {
  return {
    headers: [`content-disposition: form-data; name="${name}"; filename="${filename}"`, `content-type: ${mediaType}`],
    body,
  }
}

function field(name: string, body: string): { headers: string[]; body: string } {
  return { headers: [`content-disposition: form-data; name="${name}"`], body }
}

/** Deterministic filler - readable bytes, so a hand-built body stays a valid string. */
function filler(size: number, seed = 1): string {
  let out = ''
  let state = seed
  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) % 2147483648
    out += String.fromCharCode(33 + (state % 90))
  }
  return out
}

async function buildCorpus(): Promise<Body[]> {
  const bodies: Body[] = []

  const fromForm = async (label: string, form: FormData): Promise<void> => {
    const { contentType, body } = await serialize(form)
    bodies.push({ label, contentType, bytes: body })
  }

  const single = new FormData()
  single.append('title', 'hello')
  await fromForm('form: one field', single)

  const mixed = new FormData()
  mixed.append('title', 'hello')
  mixed.append('doc', new File(['payload'], 'a.txt', { type: 'text/plain' }))
  mixed.append('tag', 'x')
  await fromForm('form: field, file, field', mixed)

  const unicode = new FormData()
  unicode.append('greeting', 'привіт 🌍 - вітання')
  unicode.append('café', 'crème brûlée')
  unicode.append('doc', new File(['ünïcödé'], 'résumé.pdf', { type: 'application/pdf' }))
  await fromForm('form: unicode values, latin-1 names', unicode)

  const nonLatin = new FormData()
  nonLatin.append('назва', 'привіт')
  nonLatin.append('файл', new File(['PNGDATA'], 'фото.png', { type: 'image/png' }))
  nonLatin.append('photo', new File(['PNGDATA'], 'звіт 🐿.pdf', { type: 'application/pdf' }))
  await fromForm('form: non latin-1 names and filenames', nonLatin)

  const repeated = new FormData()
  repeated.append('tag', 'first')
  repeated.append('tag', 'second')
  repeated.append('doc', new File(['one'], 'one.txt', { type: 'text/plain' }))
  repeated.append('doc', new File(['two'], 'two.txt', { type: 'text/plain' }))
  await fromForm('form: repeated names', repeated)

  const empties = new FormData()
  empties.append('note', '')
  empties.append('avatar', new File([], 'empty.png', { type: 'image/png' }))
  empties.append('tiny', new File(['x'], 'tiny.bin', { type: 'application/octet-stream' }))
  await fromForm('form: empty field, empty file, one-byte file', empties)

  const big = new FormData()
  big.append('title', 'big one')
  big.append('doc', new File([filler(6 * 1024, 7)], 'big.bin', { type: 'application/octet-stream' }))
  big.append('trailer', 'end')
  await fromForm('form: 6 KB file between fields', big)

  bodies.push({
    label: 'manual: quoted boundary',
    contentType: 'multipart/form-data; boundary="quoted-bnd-42"',
    bytes: buildBody('quoted-bnd-42', [field('title', 'quoted'), file('doc', 'a.txt', 'text/plain', 'payload')]),
  })

  bodies.push({
    label: 'manual: empty file input next to a real upload',
    contentType: 'multipart/form-data; boundary=empty-bnd',
    bytes: buildBody('empty-bnd', [
      file('avatar', '', 'application/octet-stream', ''),
      file('doc', 'doc.txt', 'text/plain', 'real'),
    ]),
  })

  bodies.push({
    label: 'manual: bracketed names, extra part headers',
    contentType: 'multipart/form-data; boundary=extra-bnd',
    bytes: buildBody('extra-bnd', [
      { headers: ['content-disposition: form-data; name="files[]"'], body: 'a' },
      {
        headers: [
          'Content-Disposition: form-data; name="files[]"; filename="b.txt"',
          'Content-Type: text/plain',
          'X-Checksum: 42',
        ],
        body: 'b',
      },
    ]),
  })

  bodies.push({
    label: 'manual: eight small parts',
    contentType: 'multipart/form-data; boundary=many-bnd',
    bytes: buildBody(
      'many-bnd',
      Array.from({ length: 8 }, (_, i) =>
        i % 2 === 0 ? field(`f${i}`, filler(12, i + 1)) : file(`u${i}`, `${i}.bin`, 'application/octet-stream', 'zz'),
      ),
    ),
  })

  bodies.push({
    label: 'manual: 24 KB file after a field',
    contentType: 'multipart/form-data; boundary=large-bnd',
    bytes: buildBody('large-bnd', [
      field('title', 'large'),
      file('doc', 'large.bin', 'application/octet-stream', filler(24 * 1024, 3)),
    ]),
  })

  return bodies
}

const corpus = await buildCorpus()

// ─── Cut points ──────────────────────────────────────────────────

const EXHAUSTIVE_LIMIT = 1200
const TAIL_WINDOW = 96
const SAMPLED_CUTS = 60

function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * Every split for a short body; for a long one the head, the whole terminator
 * window at the end, and a seeded sample in between.
 */
function cutPoints(length: number, seed: number): number[] {
  if (length <= EXHAUSTIVE_LIMIT) return Array.from({ length: length - 1 }, (_, i) => i + 1)

  const cuts = new Set<number>()
  for (let i = 1; i <= TAIL_WINDOW; i++) {
    cuts.add(i)
    cuts.add(length - i)
  }
  const random = lcg(seed)
  while (cuts.size < TAIL_WINDOW * 2 + SAMPLED_CUTS) cuts.add(1 + Math.floor(random() * (length - 2)))
  return [...cuts].sort((a, b) => a - b)
}

const stats = { bodies: 0, runs: 0, cuts: 0 }

/** A stalled bridge has to be reported as a mismatch - otherwise it just hangs the suite. */
const DEADLINE_MS = 2000

function withDeadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`stalled for ${DEADLINE_MS}ms at ${label}`)), DEADLINE_MS)
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

// ─── The diff ────────────────────────────────────────────────────

describe('differential - the runtime parser as oracle', () => {
  it('agrees with the reference on the whole corpus, delivered in one chunk', async () => {
    for (const body of corpus) {
      const expected = comparable(await reference(body.bytes, body.contentType))
      expect(expected.length).toBeGreaterThan(0)
      expect(comparable(await subject([body.bytes], body.contentType))).toEqual(expected)
      stats.bodies++
      stats.runs++
    }
  })

  it('agrees with the reference at every cut point', async () => {
    const mismatches: string[] = []

    for (const [index, body] of corpus.entries()) {
      const expected = JSON.stringify(comparable(await reference(body.bytes, body.contentType)))
      for (const cut of cutPoints(body.bytes.length, index + 1)) {
        stats.runs++
        stats.cuts++
        try {
          const parsed = await withDeadline(
            subject(splitAt(body.bytes, cut), body.contentType),
            `${body.label} @ ${cut}`,
          )
          const actual = JSON.stringify(comparable(parsed))
          if (actual !== expected) mismatches.push(`${body.label} @ ${cut}: ${actual}`)
        } catch (error) {
          mismatches.push(`${body.label} @ ${cut}: ${(error as Error).message}`)
        }
      }
    }

    expect(mismatches).toEqual([])
    expect(stats.cuts).toBeGreaterThan(2500)
  }, 60_000)

  it('agrees with the reference on fixed-size chunking', async () => {
    for (const body of corpus) {
      const expected = comparable(await reference(body.bytes, body.contentType))
      for (const size of [1, 3, 17, 64, 512]) {
        if (size === 1 && body.bytes.length > EXHAUSTIVE_LIMIT) continue
        stats.runs++
        const chunks = size === 1 ? eachByte(body.bytes) : chunkSized(body.bytes, size)
        expect(comparable(await subject(chunks, body.contentType))).toEqual(expected)
      }
    }
  })

  it('ran the corpus it claims to have run', () => {
    expect(stats.bodies).toBe(corpus.length)
    expect(corpus.length).toBeGreaterThanOrEqual(11)
    expect(stats.runs).toBeGreaterThan(3000)
  })
})

// ─── What these tests caught ─────────────────────────────────────

describe('regression - a file part handed over before its bytes arrive', () => {
  /**
   * A part stream issues its first `pull` the moment the part is built, which
   * can be several `next()` calls before the consumer receives it. That pull
   * used to find the read loop mid-flight, have its `fill()` dropped, and park
   * on the gate; the loop's own re-check still saw the part queued and stopped
   * reading, so nothing ever woke it again. Fourteen of the 293 cut points
   * below hung the bridge for good.
   */
  it('never stalls, whatever the chunk split', async () => {
    const contentType = 'multipart/form-data; boundary=stall-bnd'
    const body = buildBody('stall-bnd', [
      field('note', ''),
      file('avatar', 'empty.png', 'image/png', ''),
      file('tiny', 'tiny.bin', 'text/plain', 'x'),
    ])

    const expected = JSON.stringify(comparable(await reference(body, contentType)))
    const failures: string[] = []

    for (let cut = 1; cut < body.length; cut++) {
      try {
        const parsed = await withDeadline(subject(splitAt(body, cut), contentType), `cut ${cut}`)
        const actual = JSON.stringify(comparable(parsed))
        if (actual !== expected) failures.push(`cut ${cut}: ${actual}`)
      } catch (error) {
        failures.push(`cut ${cut}: ${(error as Error).message}`)
      }
    }

    expect(failures).toEqual([])
    expect(body.length).toBeGreaterThan(280)
  }, 60_000)
})

// ─── Where we differ on purpose ──────────────────────────────────

describe('deliberate divergences from the runtime parser', () => {
  it('takes the media type from the part, where the oracle guesses from the filename', async () => {
    const contentType = 'multipart/form-data; boundary=type-bnd'
    const body = buildBody('type-bnd', [
      file('page', 'page.txt', 'text/html', '<b>'),
      { headers: ['content-disposition: form-data; name="bare"; filename="a.bin"'], body: 'hi' },
      file('raw', 'dump', 'application/pdf', 'x'),
    ])

    const native = [...(await nativeForm(body, contentType)).values()] as unknown as File[]
    // The extension decides all three: a declared `text/html` is overruled, a
    // part with no header at all still gets a type, and an extensionless
    // filename gets none. The header never reaches the oracle - which is why
    // `mediaType` is left out of the diff above.
    expect(native.map((entry) => entry.type)).toEqual(['text/plain;charset=utf-8', 'application/octet-stream', ''])

    const parts = await subject([body], contentType)
    expect(parts.map((part) => part.mediaType)).toEqual(['text/html', 'application/octet-stream', 'application/pdf'])
  })

  it('reports the media type without its parameters', async () => {
    const contentType = 'multipart/form-data; boundary=param-bnd'
    const body = buildBody('param-bnd', [file('doc', 'a.txt', 'text/plain; charset=utf-8', 'x')])

    for await (const part of createPartStream(chunkedRequest(contentType, [body]))) {
      expect(part.type).toBe('file')
      // `mediaType` is the media type; the header it came from stays intact.
      expect((part as { mediaType: string }).mediaType).toBe('text/plain')
      expect(part.headers['content-type']).toBe('text/plain; charset=utf-8')
    }
  })

  it('calls a nameless octet-stream part a file, where the oracle calls it a field', async () => {
    const contentType = 'multipart/form-data; boundary=blob-bnd'
    const body = buildBody('blob-bnd', [
      {
        headers: ['content-disposition: form-data; name="blob"', 'content-type: application/octet-stream'],
        body: 'raw',
      },
    ])

    const native = await nativeForm(body, contentType)
    expect(native.get('blob')).toBe('raw')

    // No browser sends this shape; the engine treats a binary body as an upload
    // even without a filename, and streaming it beats buffering it as a string.
    const parts = await subject([body], contentType)
    expect(parts[0]).toMatchObject({ kind: 'file', name: 'blob', filename: undefined })
  })

  it('keeps an empty file input on the part stream but out of the buffered form', async () => {
    const body = buildBody('empty-bnd', [
      file('avatar', '', 'application/octet-stream', ''),
      file('doc', 'doc.txt', 'text/plain', 'real'),
    ])
    const contentType = 'multipart/form-data; boundary=empty-bnd'

    const native = await nativeForm(body, contentType)
    expect([...native.keys()]).toEqual(['avatar', 'doc'])

    const parts = await subject([body], contentType)
    expect(parts.map((part) => part.name)).toEqual(['avatar', 'doc'])

    // An `<input type="file">` the user left alone is not an upload.
    const form = await collectForm(createPartStream(chunkedRequest(contentType, [body])))
    expect(Object.keys(form.files)).toEqual(['doc'])
  })

  it('collapses repeated fields to the last value and groups repeated files', async () => {
    const source = new FormData()
    source.append('tag', 'first')
    source.append('tag', 'second')
    source.append('doc', new File(['one'], 'one.txt', { type: 'text/plain' }))
    source.append('doc', new File(['two'], 'two.txt', { type: 'text/plain' }))
    const { contentType, body } = await serialize(source)

    const native = await nativeForm(body, contentType)
    expect(native.getAll('tag')).toEqual(['first', 'second'])

    // Every part is still visible on `ctx.parts`; the buffered form is the
    // flat shape a schema reads, so a field name holds one string.
    const form = await collectForm(createPartStream(chunkedRequest(contentType, [body])))
    expect(form.fields).toEqual({ tag: 'second' })
    expect(form.files.doc?.map((entry) => entry.name)).toEqual(['one.txt', 'two.txt'])
  })
})

// ─── The engine defect we read around ────────────────────────────

/**
 * multipasta 0.2.8 parses `content-disposition` with fast-content-type-parse,
 * whose quoted-string pattern stops at U+00FF. One character above it voids the
 * whole header: `info.name` comes out empty, `info.filename` undefined, and
 * with the filename gone a file is delivered as a field. `résumé.pdf` survives,
 * `фото.png` does not - and an ASCII part name does not help, one такий
 * filename is enough. The media type goes with it: the engine reads the RFC
 * 7578 default off that same parse, so a part with no `Content-Type` of its own
 * is labelled `text/plain` rather than `application/octet-stream`.
 *
 * The defect is still there; what the bridge does about it is take the names
 * and the media type from the raw headers on `info.headers`, which the engine
 * leaves intact, and hand the engine its own `isFile` built on that reading.
 */
describe('engine defect - non latin-1 characters in content-disposition', () => {
  const contentType = 'multipart/form-data; boundary=u-bnd'
  const body = buildBody('u-bnd', [
    field('назва', 'привіт'),
    file('файл', 'фото.png', 'image/png', 'PNGDATA'),
    file('photo', 'фото.png', 'image/png', 'PNGDATA'),
  ])

  it('is parsed correctly by the runtime', async () => {
    const native = await nativeForm(body, contentType)
    expect([...native.keys()]).toEqual(['назва', 'файл', 'photo'])
    expect((native.get('photo') as File).name).toBe('фото.png')
  })

  it('keeps the name and the file-ness of such a part', async () => {
    const parts = await subject([body], contentType)

    expect(parts[0]).toEqual({ kind: 'field', name: 'назва', value: 'привіт' })
    expect(parts[1]).toMatchObject({ kind: 'file', name: 'файл', filename: 'фото.png' })
    expect(parts[2]).toMatchObject({ kind: 'file', name: 'photo', filename: 'фото.png' })
    expect(comparable(parts)).toEqual(comparable(await reference(body, contentType)))
  })

  it('gives such a part the binary default when it declares no media type', async () => {
    const bareBody = buildBody('bare-bnd', [
      { headers: ['content-disposition: form-data; name="файл"; filename="фото.png"'], body: 'PNGDATA' },
    ])
    const bareType = 'multipart/form-data; boundary=bare-bnd'

    // The engine takes the default from a disposition it failed to read, which
    // leaves it with no filename and so with `text/plain` - the media type of a
    // field, not of a file.
    const parts = await subject([bareBody], bareType)
    expect(parts[0]).toEqual({
      kind: 'file',
      name: 'файл',
      filename: 'фото.png',
      mediaType: 'application/octet-stream',
      digest: digest(new TextEncoder().encode('PNGDATA')),
    })
  })

  it('carries an emoji filename through', async () => {
    const emojiBody = buildBody('emoji-bnd', [file('pic', '🐿 photo.png', 'image/png', 'PNGDATA')])
    const emojiType = 'multipart/form-data; boundary=emoji-bnd'

    const parts = await subject([emojiBody], emojiType)
    expect(parts[0]).toMatchObject({ kind: 'file', name: 'pic', filename: '🐿 photo.png' })
    expect(comparable(parts)).toEqual(comparable(await reference(emojiBody, emojiType)))
  })

  it('reads a cyrillic name next to a latin-1 one', async () => {
    const mixedBody = buildBody('mix-bnd', [
      file('файл', 'résumé.pdf', 'application/pdf', 'PDFDATA'),
      file('café', 'звіт.pdf', 'application/pdf', 'PDFDATA'),
    ])
    const mixedType = 'multipart/form-data; boundary=mix-bnd'

    const parts = await subject([mixedBody], mixedType)
    expect(parts.map((part) => [part.name, part.filename])).toEqual([
      ['файл', 'résumé.pdf'],
      ['café', 'звіт.pdf'],
    ])
    expect(comparable(parts)).toEqual(comparable(await reference(mixedBody, mixedType)))
  })

  it('keeps a semicolon inside a quoted filename', async () => {
    const semiBody = buildBody('semi-bnd', [file('doc', 'a;b.txt', 'text/plain', 'payload')])
    const semiType = 'multipart/form-data; boundary=semi-bnd'

    const parts = await subject([semiBody], semiType)
    expect(parts[0]).toMatchObject({ kind: 'file', name: 'doc', filename: 'a;b.txt' })
    expect(comparable(parts)).toEqual(comparable(await reference(semiBody, semiType)))
  })

  it('unescapes a quoted pair inside a quoted filename', async () => {
    const escapedBody = buildBody('esc-bnd', [file('doc', 'a\\"b.txt', 'text/plain', 'payload')])
    const escapedType = 'multipart/form-data; boundary=esc-bnd'

    // RFC 7578 reads the value as an RFC 2616 quoted-string, so `\"` is one
    // quote. The runtime keeps the backslash - a divergence we take on purpose,
    // since a browser escapes the quote as `%22` and never emits this shape.
    const native = [...(await nativeForm(escapedBody, escapedType)).values()] as unknown as File[]
    expect(native[0].name).toBe('a\\"b.txt')

    const parts = await subject([escapedBody], escapedType)
    expect(parts[0]).toMatchObject({ kind: 'file', name: 'doc', filename: 'a"b.txt' })
  })

  it('leaves an empty file input empty', async () => {
    const emptyBody = buildBody('void-bnd', [
      file('avatar', '', 'application/octet-stream', ''),
      file('файл', '', 'application/octet-stream', ''),
    ])
    const emptyType = 'multipart/form-data; boundary=void-bnd'

    const empty = digest(new Uint8Array())
    const parts = await subject([emptyBody], emptyType)
    expect(parts).toEqual([
      { kind: 'file', name: 'avatar', filename: '', mediaType: 'application/octet-stream', digest: empty },
      { kind: 'file', name: 'файл', filename: '', mediaType: 'application/octet-stream', digest: empty },
    ])

    const form = await collectForm(createPartStream(chunkedRequest(emptyType, [emptyBody])))
    expect(Object.keys(form.files)).toEqual([])
  })

  it('still rejects a part with no name at all', async () => {
    const namelessBody = buildBody('anon-bnd', [{ headers: ['content-disposition: form-data'], body: 'x' }])

    await expect(subject([namelessBody], 'multipart/form-data; boundary=anon-bnd')).rejects.toThrow(/missing a name/)
  })
})
