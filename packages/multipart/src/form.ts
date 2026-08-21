import type { FormResult, MultipartPart } from './types.js'

/**
 * Drains the part iterator in a single pass: files are buffered into `File`
 * objects grouped by part name, fields collapse to the last value under their
 * name.
 *
 * A part with `filename=""` and no bytes is an empty `<input type="file">`, not
 * an upload - it is left out of `files` while staying visible on `ctx.parts`.
 */
export async function collectForm(parts: AsyncIterableIterator<MultipartPart>): Promise<FormResult> {
  const files: Record<string, File[]> = {}
  const fields: Record<string, string> = {}

  for await (const part of parts) {
    if (part.type === 'field') {
      fields[part.name] = part.value
      continue
    }

    const bytes = await part.bytes()
    if (!part.filename && bytes.length === 0) continue

    // `File` wants an ArrayBuffer-backed view; the parser never yields a shared one.
    const file = new File([bytes as Uint8Array<ArrayBuffer>], part.filename ?? '', { type: part.mediaType })
    const existing = files[part.name]
    if (existing) existing.push(file)
    else files[part.name] = [file]
  }

  return { files, fields }
}
