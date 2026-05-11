import { extname } from 'node:path'

const MIME_TYPES: Record<string, string> = {
  // Text
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',

  // JavaScript / WASM
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.wasm': 'application/wasm',

  // Data
  '.json': 'application/json',
  '.map': 'application/json',
  '.pdf': 'application/pdf',

  // Images
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',

  // Audio / Video
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',

  // Archives
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
}

export function getMimeType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

const TEXT_TYPES = new Set<string>([
  'text/html',
  'text/css',
  'text/plain',
  'text/csv',
  'text/yaml',
  'application/javascript',
  'application/json',
  'application/xml',
  'image/svg+xml',
])

export function withCharset(mimeType: string): string {
  const base = mimeType.split(';')[0].trim()
  if (!TEXT_TYPES.has(base)) return mimeType
  if (mimeType.toLowerCase().includes('charset=')) return mimeType
  return `${mimeType}; charset=utf-8`
}
