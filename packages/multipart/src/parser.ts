import {
  BadRequestException,
  HttpException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@miiajs/core'
import * as MP from 'multipasta'
import { parseContentDisposition } from './content-disposition.js'
import { parseContentType, parseMediaType } from './content-type.js'
import type { FilePart, MultipartOptions, MultipartPart } from './types.js'

const DEFAULT_MAX_FIELD_SIZE = 1024 * 1024
const DEFAULT_MAX_FIELD_NAME_SIZE = 100
export const DEFAULT_FIELDS_BUDGET = 64 * 1024

/**
 * Extra bytes held back on top of the boundary length. The closing delimiter is
 * `\r\n--boundary--\r\n` (boundary + 8), the margin covers any disagreement
 * between how we read the boundary and how multipasta reads it (quotes,
 * quoted-pairs).
 */
const TAIL_MARGIN = 16
const FALLBACK_BOUNDARY_LENGTH = 70

/** RFC 7578 defaults for a part that declares no `Content-Type` of its own. */
const FIELD_MEDIA_TYPE = 'text/plain'
const FILE_MEDIA_TYPE = 'application/octet-stream'

const noop = (): void => {}

interface Gate {
  wait(): Promise<void>
  wake(): void
}

function createGate(): Gate {
  let waiters: Array<() => void> = []
  return {
    wait() {
      return new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    },
    wake() {
      if (waiters.length === 0) return
      const pending = waiters
      waiters = []
      for (const resolve of pending) resolve()
    },
  }
}

interface FileState {
  chunks: Uint8Array[]
  finished: boolean
  discarded: boolean
  error: unknown
  size: number
  counted: boolean
  gate: Gate
  controller: ReadableStreamDefaultController<Uint8Array> | null
}

interface PendingEntry {
  part: MultipartPart
  file: FileState | null
}

/** `name`, `filename` and media type as the bridge reads them, not as the engine did. */
interface PartMeta {
  name: string
  filename?: string
  mediaType: string
  /** Whether the raw header carried either parameter at all. */
  named: boolean
}

/**
 * Streams a `multipart/form-data` request as an async iterator of parts.
 *
 * Backpressure is real: the source is only read when every queue the consumer
 * can still drain is empty. Exactly one part is consumed at a time - moving the
 * iterator forward abandons the previous part and errors its stream rather than
 * closing it, so a half-read upload can never look complete.
 */
export function createPartStream(req: Request, options: MultipartOptions = {}): AsyncIterableIterator<MultipartPart> {
  const contentType = req.headers.get('content-type') ?? ''
  const parsed = parseContentType(contentType)
  if (parsed.mediaType !== 'multipart/form-data') {
    throw new BadRequestException('Expected a multipart/form-data request body')
  }

  const maxFileSize = options.maxFileSize ?? Number.POSITIVE_INFINITY
  const maxFiles = options.maxFiles ?? Number.POSITIVE_INFINITY
  const maxFields = options.maxFields ?? Number.POSITIVE_INFINITY
  const maxFieldSize = options.maxFieldSize ?? DEFAULT_MAX_FIELD_SIZE
  const maxFieldNameSize = options.maxFieldNameSize ?? DEFAULT_MAX_FIELD_NAME_SIZE
  const fieldsBudget = options.fieldsBudget ?? DEFAULT_FIELDS_BUDGET
  const allowedTypes = normalizeAllowedTypes(options.allowedTypes)
  const maxParts =
    Number.isFinite(maxFiles) && Number.isFinite(maxFields) ? maxFiles + maxFields : Number.POSITIVE_INFINITY
  const maxTotalSize = resolveMaxTotalSize(options.bodyLimit, maxFileSize, maxFiles, fieldsBudget)
  const tailSize = (parsed.boundary?.length ?? FALLBACK_BOUNDARY_LENGTH) + TAIL_MARGIN

  const pending: PendingEntry[] = []
  const partsGate = createGate()
  const liveFiles = new Set<FileState>()

  let currentFile: FileState | null = null
  let failure: unknown = null
  let stopped = false
  let closed = false
  let advancing = false
  let doneReceived = false
  let sourceDone = false
  let released = false
  let fileCount = 0
  let fieldCount = 0
  let tail: Uint8Array | null = null

  // ─── Source ────────────────────────────────────────────────────

  const reader = (req.body ?? emptyStream()).getReader()
  let pendingRead: ReturnType<typeof reader.read> | null = null
  let filling: Promise<void> | null = null

  /**
   * The source is never cancelled and never drained: `cancel()` on a
   * `Readable.toWeb` stream tears down the socket and kills the 413 the handler
   * is about to write. We stop reading and let the adapter dispose of
   * the connection.
   */
  function releaseSource(): void {
    if (released) return
    released = true
    if (pendingRead) pendingRead.then(noop, noop)
    try {
      reader.releaseLock()
    } catch {
      // an outstanding read still holds the lock; the adapter cleans up
    }
  }

  // ─── Failure latch ─────────────────────────────────────────────
  // multipasta keeps calling `onError` and keeps buffering after the first
  // failure, so the first error stops the bridge for good.

  function fail(error: unknown): void {
    if (stopped) return
    stopped = true
    failure = error
    for (const file of liveFiles) errorFile(file, error)
    liveFiles.clear()
    partsGate.wake()
    releaseSource()
  }

  /**
   * A throw out of `parser.write()` / `parser.end()`. multipasta 0.2.8 decodes
   * an RFC 5987 `filename*` inside `write()`, so `filename*=UTF-8''%%%` raises a
   * `URIError` from under the reading loop, which nothing awaits: unlatched it
   * would hang the request and surface as an unhandled rejection. The header is
   * the client's, so it reads as a malformed request.
   */
  function failParsing(error: unknown): void {
    fail(error instanceof HttpException ? error : new BadRequestException('Malformed multipart part headers'))
  }

  function errorFile(file: FileState, error: unknown): void {
    if (file.error) return
    file.error = error
    file.chunks.length = 0
    file.controller?.error(error)
    file.gate.wake()
  }

  function limitExceeded(limit: string, message: string): PayloadTooLargeException {
    return new PayloadTooLargeException(message, { limit })
  }

  // ─── Part metadata ─────────────────────────────────────────────
  // The engine voids a `content-disposition` carrying a character above U+00FF,
  // so the names - and with them the media type of a part that declares none -
  // come from our own reading of the raw headers. The engine calls `isFile`
  // once per part and hands the same `info` to `onFile`/`onField` straight
  // after, so a single slot carries that reading across the three.

  let readInfo: MP.PartInfo | null = null
  let readMeta: PartMeta = { name: '', mediaType: FIELD_MEDIA_TYPE, named: false }

  function metaOf(info: MP.PartInfo): PartMeta {
    if (info !== readInfo) {
      readInfo = info
      const { name, filename } = parseContentDisposition(info.headers['content-disposition'])
      readMeta = {
        name: name ?? '',
        filename,
        mediaType: mediaTypeOf(info.headers['content-type'], filename !== undefined),
        named: name !== undefined || filename !== undefined,
      }
    }
    return readMeta
  }

  /** The engine's own rule - a filename, or a binary body - on our reading. */
  const isFile = (info: MP.PartInfo): boolean => {
    const meta = metaOf(info)
    return meta.filename !== undefined || meta.mediaType === FILE_MEDIA_TYPE
  }

  // ─── Parser callbacks ──────────────────────────────────────────

  /**
   * The engine only refuses an unnamed part when it managed to read
   * `form-data` out of the disposition, so a part carrying no
   * `content-disposition` at all - or one it read nothing from - arrives as a
   * field named `''`. Ours is the only reading that sees it.
   */
  function checkDisposition(meta: PartMeta): boolean {
    if (meta.named) return true
    fail(new BadRequestException('Multipart part is missing a name'))
    return false
  }

  function checkName(name: string): boolean {
    if (name.length <= maxFieldNameSize) return true
    fail(limitExceeded('maxFieldNameSize', 'Multipart part name is too long'))
    return false
  }

  /**
   * Runs at the head of a file part, before a byte of its body is read: the
   * refusal is what saves the upload, so it cannot wait for the stream.
   */
  function checkMediaType(mediaType: string): boolean {
    if (allowedTypes === null || matchesAllowedTypes(allowedTypes, mediaType)) return true
    fail(
      new UnsupportedMediaTypeException(`Media type ${mediaType} is not allowed`, {
        mediaType,
        allowed: allowedTypes,
      }),
    )
    return false
  }

  const onFile = (info: MP.PartInfo): ((chunk: Uint8Array | null) => void) => {
    const meta = metaOf(info)
    if (stopped || !checkDisposition(meta) || !checkName(meta.name) || !checkMediaType(meta.mediaType)) return noop

    const file: FileState = {
      chunks: [],
      finished: false,
      discarded: false,
      error: null,
      size: 0,
      counted: false,
      gate: createGate(),
      controller: null,
    }
    liveFiles.add(file)
    pending.push({ part: createFilePart(info, meta, file), file })
    partsGate.wake()

    return (chunk: Uint8Array | null) => {
      if (stopped) return
      if (chunk === null) {
        file.finished = true
        liveFiles.delete(file)
        file.gate.wake()
        return
      }
      if (file.discarded || file.error) return

      // A part with `filename=""` and no bytes is an empty file input, not an
      // upload - the count only moves once the part actually carries data.
      if (!file.counted) {
        file.counted = true
        fileCount++
        if (fileCount > maxFiles) return fail(limitExceeded('maxFiles', 'Too many files'))
      }

      file.size += chunk.length
      if (file.size > maxFileSize) return fail(limitExceeded('maxFileSize', 'File is too large'))

      file.chunks.push(chunk)
      file.gate.wake()
    }
  }

  const onField = (info: MP.PartInfo, value: Uint8Array): void => {
    const meta = metaOf(info)
    if (stopped || !checkDisposition(meta) || !checkName(meta.name)) return

    fieldCount++
    if (fieldCount > maxFields) return fail(limitExceeded('maxFields', 'Too many fields'))

    pending.push({
      part: { type: 'field', name: meta.name, value: MP.decodeField(info, value), headers: info.headers },
      file: null,
    })
    partsGate.wake()
  }

  const onDone = (): void => {
    doneReceived = true
    partsGate.wake()
    for (const file of liveFiles) file.gate.wake()
  }

  const parser = MP.make({
    headers: { 'content-type': contentType },
    isFile,
    maxFieldSize,
    maxParts,
    maxTotalSize,
    onField,
    onFile,
    onError: (error) => fail(mapMultipartError(error)),
    onDone,
  })

  // `InvalidBoundary` is reported from `make()` itself, before a single byte is read.
  if (failure) throw failure

  // ─── Reading loop ──────────────────────────────────────────────

  function needsMore(): boolean {
    if (stopped || sourceDone || doneReceived) return false
    if (pending.length > 0) return false
    if (currentFile && !currentFile.discarded && currentFile.chunks.length > 0) return false
    return true
  }

  /**
   * Holds back the last `boundary + 16` bytes until the next chunk arrives, so
   * the closing `--boundary--` can never be split across two `write()` calls -
   * multipasta 0.2.8 mistakes a one-byte remainder for a header block.
   */
  function feed(chunk: Uint8Array): void {
    if (stopped || doneReceived) return

    let buf = chunk
    if (tail !== null && tail.length > 0) {
      const merged = new Uint8Array(tail.length + chunk.length)
      merged.set(tail)
      merged.set(chunk, tail.length)
      buf = merged
    }

    if (buf.length <= tailSize) {
      tail = buf
      return
    }

    const cut = buf.length - tailSize
    tail = buf.subarray(cut)
    parser.write(buf.subarray(0, cut))
  }

  function flushTail(): void {
    const rest = tail
    tail = null
    if (rest && rest.length > 0 && !stopped && !doneReceived) parser.write(rest)
  }

  async function runFill(): Promise<void> {
    while (needsMore()) {
      let result: Awaited<ReturnType<typeof reader.read>>
      try {
        const read = reader.read()
        pendingRead = read
        result = await read
      } catch (error) {
        // Source errors travel untouched: the adapter body ceiling rejects with
        // an `Error` named `PayloadTooLargeError` that core maps to 413 by name.
        if (!released) fail(error)
        return
      } finally {
        pendingRead = null
      }

      if (stopped) return

      if (result.done) {
        sourceDone = true
        try {
          flushTail()
          if (!stopped && !doneReceived) parser.end()
        } catch (error) {
          failParsing(error)
        }
        if (!stopped && !doneReceived) fail(new BadRequestException('Malformed multipart/form-data body'))
        partsGate.wake()
        for (const file of liveFiles) file.gate.wake()
        return
      }

      try {
        feed(result.value)
      } catch (error) {
        failParsing(error)
        return
      }
    }
  }

  /**
   * Single-flight: both the iterator and a part stream wake the gate, and two
   * concurrent `reader.read()` calls would feed the parser in microtask order.
   * The re-check on release covers a consumer that drained a queue while the
   * loop was already on its way out.
   */
  function fill(): void {
    if (filling || stopped || sourceDone || doneReceived) return
    filling = runFill().finally(() => {
      filling = null
      if (needsMore()) fill()
    })
  }

  // ─── Parts ─────────────────────────────────────────────────────

  function createFilePart(info: MP.PartInfo, meta: PartMeta, file: FileState): FilePart {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        file.controller = controller
      },
      pull: async (controller) => {
        for (;;) {
          if (file.error) throw file.error
          const chunk = file.chunks.shift()
          if (chunk !== undefined) {
            controller.enqueue(chunk)
            return
          }
          if (file.finished) {
            controller.close()
            return
          }
          if (failure) throw failure
          fill()
          await file.gate.wait()
        }
      },
      cancel: () => {
        file.discarded = true
        file.chunks.length = 0
        liveFiles.delete(file)
        file.gate.wake()
        fill()
      },
    })

    // Cached the way `ctx.json()` caches the body: the stream is drained once,
    // and a second call hands back the same bytes instead of an empty read of a
    // stream that is already closed.
    let bytes: Promise<Uint8Array> | null = null

    return {
      type: 'file',
      name: meta.name,
      filename: meta.filename,
      mediaType: meta.mediaType,
      headers: info.headers,
      stream,
      bytes: () => (bytes ??= readAll(stream)),
    }
  }

  /**
   * Moving on abandons whatever is left of the previous part. The stream is
   * errored, not closed: a closed stream would hand the consumer a silently
   * truncated file.
   *
   * Every part the consumer did not read to the end is errored, including one
   * whose bytes had all arrived already - a small part delivered in a single
   * chunk sits complete in the stream's queue, and letting that one through
   * would make the contract depend on how the body happened to be split.
   */
  function discardCurrent(): void {
    const file = currentFile
    currentFile = null
    if (!file || file.discarded || file.error) return

    file.discarded = true
    liveFiles.delete(file)
    errorFile(file, new Error('Multipart part was abandoned before it was fully consumed'))
  }

  const iterator: AsyncIterableIterator<MultipartPart> = {
    [Symbol.asyncIterator]() {
      return iterator
    },

    async next(): Promise<IteratorResult<MultipartPart>> {
      if (closed) return { value: undefined, done: true }
      // Two `next()` calls in flight would both wait on the same gate while the
      // first part they woke for keeps the reading loop from asking for more -
      // a deadlock. Parts are consumed one at a time, so say so.
      if (advancing) {
        throw new Error('Multipart parts are consumed one at a time - await the previous next() before the next one')
      }

      advancing = true
      try {
        discardCurrent()
        for (;;) {
          if (failure) throw failure

          const entry = pending.shift()
          if (entry) {
            currentFile = entry.file
            // A part stream issues its first `pull` when it is built, which can
            // be long before the consumer receives the part. That pull may find
            // the loop mid-flight, and its `fill()` is dropped; the loop's own
            // re-check then still sees this entry queued and stops reading. Only
            // handing the part over releases the queue, so the retry belongs here.
            fill()
            return { value: entry.part, done: false }
          }

          if (doneReceived || sourceDone) {
            releaseSource()
            return { value: undefined, done: true }
          }

          fill()
          await partsGate.wait()
        }
      } finally {
        advancing = false
      }
    },

    async return(): Promise<IteratorResult<MultipartPart>> {
      closed = true
      discardCurrent()
      stopped = true
      releaseSource()
      return { value: undefined, done: true }
    },
  }

  return iterator
}

/**
 * Media type of a part, without its parameters.
 *
 * RFC 7578 leaves `Content-Type` optional on a part and reads an absent one as
 * `text/plain`, or as `application/octet-stream` for a part carrying a
 * filename. The engine applies that same rule to its own reading of
 * `content-disposition`, so a file with a non latin-1 filename and no header of
 * its own comes back as text; ours reads the filename from the raw header.
 */
function mediaTypeOf(header: string | string[] | undefined, hasFilename: boolean): string {
  const fallback = hasFilename ? FILE_MEDIA_TYPE : FIELD_MEDIA_TYPE
  // A part with two `content-type` headers arrives as an array; the engine
  // reads nothing out of that shape either.
  if (typeof header !== 'string') return fallback
  return parseMediaType(header) || fallback
}

/** Read the way a part's media type is, so `Image/PNG` in the options matches. */
function normalizeAllowedTypes(allowed: string[] | undefined): string[] | null {
  return allowed === undefined ? null : allowed.map((entry) => entry.trim().toLowerCase())
}

function matchesAllowedTypes(allowed: string[], mediaType: string): boolean {
  for (const entry of allowed) {
    // `*/*` is the conventional spelling of "anything", not a subtype wildcard.
    if (entry === mediaType || entry === '*/*') return true
    if (entry.endsWith('/*') && mediaType.startsWith(entry.slice(0, -1))) return true
  }
  return false
}

function resolveMaxTotalSize(
  bodyLimit: number | undefined,
  maxFileSize: number,
  maxFiles: number,
  fieldsBudget: number,
): number {
  if (bodyLimit !== undefined) return bodyLimit
  if (Number.isFinite(maxFileSize) && Number.isFinite(maxFiles)) return maxFileSize * maxFiles + fieldsBudget
  return Number.POSITIVE_INFINITY
}

function mapMultipartError(error: MP.MultipartError): Error {
  switch (error._tag) {
    case 'ReachedLimit':
      switch (error.limit) {
        case 'MaxParts':
          return new PayloadTooLargeException('Too many parts', { limit: 'maxParts' })
        case 'MaxTotalSize':
          return new PayloadTooLargeException('Multipart body is too large', { limit: 'bodyLimit' })
        case 'MaxFieldSize':
          return new PayloadTooLargeException('Field value is too large', { limit: 'maxFieldSize' })
        default:
          return new PayloadTooLargeException('Multipart part is too large', { limit: 'maxPartSize' })
      }
    case 'InvalidBoundary':
      return new BadRequestException('Missing or invalid multipart boundary')
    case 'BadHeaders':
      return new BadRequestException('Malformed multipart part headers')
    case 'InvalidDisposition':
      return new BadRequestException('Multipart part is missing a name')
    default:
      return new BadRequestException('Malformed multipart/form-data body')
  }
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // reader already released by the stream
    }
  }

  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
