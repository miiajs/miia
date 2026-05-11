import type { Stats } from 'node:fs'

// Weak ETag (W/"size-mtime"). RFC 7232 §2.3.2 forbids weak ETags from
// validating If-Range, but Express/Fastify ignore that restriction - we
// match the ecosystem behavior for compatibility.
export function generateETag(stat: Stats): string {
  const size = stat.size.toString(16)
  const mtime = Math.floor(stat.mtimeMs).toString(16)
  return `W/"${size}-${mtime}"`
}

export function matchETag(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === '*') return true
  return ifNoneMatch.split(',').some((tag) => tag.trim() === etag)
}
