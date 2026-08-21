import type { RequestContext } from '@miiajs/core'

// ─── Options ─────────────────────────────────────────────────────

export interface MultipartOptions {
  /** Max bytes per file part, counted by the bridge. Default: `Infinity`. */
  maxFileSize?: number
  /** Max number of non-empty file parts. Default: `Infinity`. */
  maxFiles?: number
  /** Max number of field parts. Default: `Infinity`. */
  maxFields?: number
  /** Max bytes of a single field value. Default: 1 MiB. */
  maxFieldSize?: number
  /** Max length of a part name. Default: 100. */
  maxFieldNameSize?: number
  /**
   * Media types a file part may carry - an exact `image/png` or a subtype
   * wildcard `image/*`. Entries are read the way a part's media type is:
   * trimmed and lower-cased. Default: anything.
   *
   * Only **file** parts are checked. RFC 7578 reads a part that declares no
   * `Content-Type` as `text/plain`, so a list like `['image/png']` would
   * otherwise reject the form's ordinary text fields; a file declaring nothing
   * is compared as `application/octet-stream`. An empty list allows no file at
   * all.
   *
   * The check runs at the start of a part, before its body is read, and a part
   * outside the list ends the request with a `415`. The header is written by
   * the client, so this is an early refusal, not proof of what the bytes are.
   */
  allowedTypes?: string[]
  /** Budget added to the derived body limit to cover field parts. Default: 64 KiB. */
  fieldsBudget?: number
  /**
   * Explicit ceiling for the whole body. When omitted it is derived from
   * `maxFileSize * maxFiles + fieldsBudget` if both are finite, otherwise the
   * adapter ceiling is the only limit.
   */
  bodyLimit?: number
}

// ─── Parts ───────────────────────────────────────────────────────

export interface FilePart {
  readonly type: 'file'
  readonly name: string
  readonly filename?: string
  readonly mediaType: string
  readonly headers: Record<string, string | string[]>
  readonly stream: ReadableStream<Uint8Array>
  bytes(): Promise<Uint8Array>
}

export interface FieldPart {
  readonly type: 'field'
  readonly name: string
  readonly value: string
  readonly headers: Record<string, string | string[]>
}

export type MultipartPart = FilePart | FieldPart

// ─── Buffered form ───────────────────────────────────────────────

export interface FormResult {
  files: Record<string, File[]>
  fields: Record<string, string>
}

/**
 * Request context of a route carrying `@Multipart`. Both members are attached
 * by that decorator's middleware - on a route without it they are `undefined`.
 */
export interface MultipartContext extends RequestContext {
  readonly parts: AsyncIterableIterator<MultipartPart>
  form<T = FormResult>(): Promise<T>
}
