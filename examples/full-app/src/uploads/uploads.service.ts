import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BadRequestException, Injectable } from '@miiajs/core'
import type { FilePart } from '@miiajs/multipart'

// Deliberately small. @Multipart derives the route's body limit from
// maxFileSize * maxFiles, and the router raises the adapter ceiling to the
// largest route limit in the app - a generous demo would quietly lift the
// app-wide 1MB default for every other route too.
export const MAX_FILE_SIZE = 2 * 1024 * 1024
export const MAX_FILES = 3

// Refused at the part header, before a byte of the file is read. The media type
// is what the client declared, so this is an early no, not a content check.
// Kept in step with EXTENSIONS: a type that passes here must have a suffix.
export const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain']

// The name on disk is ours alone, so the suffix comes from the media type the
// part declared - never from the client's filename.
const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
}

// Served by the serve-static mount at /static (main.ts), same as avatars.
const UPLOAD_DIR = resolve(process.cwd(), 'public', 'uploads')

export interface StoredFile {
  field: string
  url: string
  originalFilename?: string
  size: number
  mediaType: string
}

@Injectable()
export class UploadsService {
  /**
   * Writes one streamed part to the uploads directory and reports where it
   * landed. The package hands out a `ReadableStream` and stops there - naming
   * and placement are the app's call, and this is where the app makes it.
   */
  async store(part: FilePart): Promise<StoredFile> {
    // Unreachable while ALLOWED_TYPES and EXTENSIONS agree - the part was
    // already refused with a 415 at its header.
    const extension = EXTENSIONS[part.mediaType]
    if (!extension) throw new BadRequestException(`Unsupported media type: ${part.mediaType}`)

    await mkdir(UPLOAD_DIR, { recursive: true })

    // Generated here, never part.filename; this is also what goes into the URL.
    const name = `${randomUUID()}${extension}`
    const target = join(UPLOAD_DIR, name)
    // Leading dot on purpose: serve-static drops path segments that start with
    // one, so a half-written file has no URL to be fetched by.
    const tmp = join(UPLOAD_DIR, `.${randomUUID()}.tmp`)
    const sink = createWriteStream(tmp)
    try {
      await pipeline(Readable.from(part.stream, { objectMode: false }), sink)
      await rename(tmp, target)
    } catch (error) {
      await unlink(tmp).catch(() => {})
      throw error
    }

    return {
      field: part.name,
      url: `/static/uploads/${name}`,
      originalFilename: part.filename,
      size: sink.bytesWritten,
      mediaType: part.mediaType,
    }
  }
}
