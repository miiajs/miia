import { PayloadTooLargeException } from './exceptions.js'

/** Default framework body limit: 1 MiB. */
export const DEFAULT_BODY_LIMIT = 1_048_576

/**
 * TransformStream that counts bytes and errors with PayloadTooLargeException
 * once `limit` is exceeded. Throwing inside transform() errors both sides:
 * the readable rejects the consumer (req.json()/req.text()/formData()), the
 * writable cancels the source stream.
 */
export function countingLimitStream(limit: number): TransformStream<Uint8Array, Uint8Array> {
  let total = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength
      if (total > limit) throw new PayloadTooLargeException(`Request body exceeded ${limit} byte limit`)
      controller.enqueue(chunk)
    },
  })
}

/**
 * Re-wraps a Request whose body has no Content-Length (chunked) so its body
 * stream errors past `ceiling` bytes. CL-framed requests are returned as-is:
 * the runtime enforces Content-Length framing and the per-route check rejects
 * oversized declared lengths. Used by Miia.listen()'s Deno branch, where the
 * runtime has no native body size limit.
 */
export function applyBodyCeiling(req: Request, ceiling: number): Request {
  if (req.body === null || req.headers.has('content-length')) return req
  return new Request(req, {
    body: req.body.pipeThrough(countingLimitStream(ceiling)),
    // `duplex` is required for stream bodies but missing from RequestInit
    // typings under types: [node, bun, deno] - hence the cast.
    duplex: 'half',
  } as RequestInit)
}
