import { createPartStream } from '../src/index.js'
import type { MultipartOptions } from '../src/index.js'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

export interface SerializedForm {
  contentType: string
  body: Uint8Array
}

/** Serializes a `FormData` the way the runtime would put it on the wire. */
export async function serialize(form: FormData): Promise<SerializedForm> {
  const res = new Response(form)
  return { contentType: res.headers.get('content-type') as string, body: new Uint8Array(await res.arrayBuffer()) }
}

/** Hand-rolled body, for boundaries the runtime would never produce (quoted, custom). */
export function buildBody(boundary: string, parts: Array<{ headers: string[]; body: string }>): Uint8Array {
  let out = ''
  for (const part of parts) {
    out += `--${boundary}\r\n`
    for (const header of part.headers) out += `${header}\r\n`
    out += `\r\n${part.body}\r\n`
  }
  out += `--${boundary}--\r\n`
  return encoder.encode(out)
}

export function chunkedRequest(contentType: string, chunks: Uint8Array[], path = '/upload'): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
    duplex: 'half',
  } as RequestInit)
}

export function splitAt(body: Uint8Array, index: number): Uint8Array[] {
  return [body.subarray(0, index), body.subarray(index)]
}

export function chunkSized(body: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let i = 0; i < body.length; i += size) chunks.push(body.subarray(i, Math.min(i + size, body.length)))
  return chunks
}

export function eachByte(body: Uint8Array): Uint8Array[] {
  return chunkSized(body, 1)
}

export interface CollectedFile {
  name: string
  filename?: string
  mediaType: string
  text: string
  size: number
}

export interface Collected {
  fields: Array<{ name: string; value: string }>
  files: CollectedFile[]
  order: string[]
}

export async function collect(req: Request, options?: MultipartOptions): Promise<Collected> {
  const result: Collected = { fields: [], files: [], order: [] }
  for await (const part of createPartStream(req, options)) {
    if (part.type === 'field') {
      result.fields.push({ name: part.name, value: part.value })
      result.order.push(`field:${part.name}`)
    } else {
      const bytes = await part.bytes()
      result.files.push({
        name: part.name,
        filename: part.filename,
        mediaType: part.mediaType,
        text: decoder.decode(bytes),
        size: bytes.length,
      })
      result.order.push(`file:${part.name}`)
    }
  }
  return result
}

/**
 * Fails the test instead of hanging the run. A deadlock in the iterator has no
 * timeout of its own, so anything that could stall waits behind this.
 */
export function deadline<T>(promise: Promise<T>, ms = 1000, label = 'the operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms)
  })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

export async function statusOf(promise: Promise<unknown>): Promise<{ statusCode: number; limit?: string }> {
  try {
    await promise
  } catch (error) {
    const err = error as { statusCode?: number; details?: { limit?: string } }
    return { statusCode: err.statusCode as number, limit: err.details?.limit }
  }
  throw new Error('expected the promise to reject')
}
