import { scanParams } from './params.js'

export interface ParsedContentType {
  mediaType: string
  boundary?: string
}

/**
 * The media type of a `Content-Type` header - parameters dropped, trimmed,
 * lower-cased. Read for the request header and for every part header.
 */
export function parseMediaType(header: string): string {
  const semi = header.indexOf(';')
  return (semi === -1 ? header : header.slice(0, semi)).trim().toLowerCase()
}

/**
 * Minimal `Content-Type` reader. Only the media type and the `boundary`
 * parameter are needed: the media type gates the request, the boundary length
 * sizes the tail buffer in the bridge.
 */
export function parseContentType(header: string): ParsedContentType {
  const semi = header.indexOf(';')
  const mediaType = parseMediaType(header)
  if (semi === -1) return { mediaType }
  const boundary = extractBoundary(header, semi + 1)
  return boundary === undefined ? { mediaType } : { mediaType, boundary }
}

function extractBoundary(header: string, start: number): string | undefined {
  let boundary: string | undefined
  scanParams(header, start, (name, value) => {
    if (name !== 'boundary') return true
    boundary = value
    return false
  })
  return boundary
}
