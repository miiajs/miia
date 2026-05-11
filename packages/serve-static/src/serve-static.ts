import { createReadStream, realpathSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { NotFoundException } from '@miiajs/core'
import type { Miia, RequestContext } from '@miiajs/core'
import { generateETag, matchETag } from './etag.js'
import { getMimeType as defaultGetMimeType, withCharset } from './mime-types.js'
import { parseRange } from './range.js'

export interface ServeStaticOptions {
  /** Index file for directory requests (default: 'index.html') */
  index?: string | false
  /** Cache-Control max-age in seconds (default: 0) */
  maxAge?: number
  /** Custom MIME type resolver. Falls back to built-in map when omitted */
  getMimeType?: (path: string) => string
  /** Send ETag and Last-Modified, honor If-None-Match / If-Modified-Since (default: true) */
  etag?: boolean
  /** Allow serving files whose URL has a segment starting with `.` (default: false) */
  dotfiles?: boolean
  /** Path inside `root` to serve when the requested file is missing and the request looks like a SPA navigation (default: false) */
  fallback?: string | false
}

function containsDotSegment(path: string): boolean {
  return path.split(/[/\\]/).some((seg) => seg.length > 0 && seg.startsWith('.'))
}

function shouldFallback(method: string, accept: string | null, relativePath: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false
  const acceptValue = accept ?? '*/*'
  if (!acceptValue.includes('text/html') && !acceptValue.includes('*/*')) return false
  const segments = relativePath.split('/')
  const last = segments[segments.length - 1] ?? ''
  const ext = extname(last).toLowerCase()
  return ext === '' || ext === '.html' || ext === '.htm'
}

export function createStaticHandler(
  root: string,
  options: ServeStaticOptions = {},
): (ctx: RequestContext) => Promise<Response> {
  const {
    index = 'index.html',
    maxAge = 0,
    getMimeType = defaultGetMimeType,
    etag: etagEnabled = true,
    dotfiles = false,
    fallback = false,
  } = options

  // realpathSync resolves any symlinks in the root path itself - common in
  // Docker/atomic deploy setups (e.g. /app/current → /app/releases/xxx).
  // Must be sync so createStaticHandler stays sync; cost is one syscall at startup.
  const resolvedRoot = realpathSync(resolve(root))

  if (fallback !== false && !dotfiles && containsDotSegment(fallback)) {
    throw new Error(`[serve-static] fallback '${fallback}' contains a dotfile segment but dotfiles are disabled`)
  }

  async function resolveFile(relativePath: string): Promise<{ realPath: string; stats: Stats } | null> {
    const filePath = normalize(join(resolvedRoot, relativePath))

    // Lexical traversal protection
    if (!filePath.startsWith(resolvedRoot)) return null

    // Resolve symlinks inside root and re-check prefix - prevents symlink escape
    // where a file inside root links to something outside.
    const realPath = await realpath(filePath).catch(() => null)
    if (!realPath || (realPath !== resolvedRoot && !realPath.startsWith(resolvedRoot + sep))) {
      return null
    }

    let stats: Stats
    try {
      stats = await stat(realPath)
    } catch {
      return null
    }

    if (!stats.isFile()) return null

    return { realPath, stats }
  }

  async function serveFile(ctx: RequestContext, relativePath: string): Promise<Response | null> {
    const resolved = await resolveFile(relativePath)
    if (!resolved) return null

    const { realPath, stats } = resolved
    const method = ctx.req.method

    const etag = generateETag(stats)
    const lastModified = new Date(stats.mtimeMs).toUTCString()
    const lastModifiedSec = Math.floor(stats.mtimeMs / 1000)

    const ifNoneMatch = ctx.req.headers.get('if-none-match')
    const ifModifiedSince = ctx.req.headers.get('if-modified-since')
    let notModified = false
    if (ifNoneMatch) {
      if (matchETag(ifNoneMatch, etag)) notModified = true
    } else if (ifModifiedSince) {
      const since = Date.parse(ifModifiedSince)
      if (!Number.isNaN(since) && lastModifiedSec <= Math.floor(since / 1000)) {
        notModified = true
      }
    }

    if (notModified) {
      const headers304: Record<string, string> = {}
      if (etagEnabled) {
        headers304.ETag = etag
        headers304['Last-Modified'] = lastModified
      }
      if (maxAge > 0) headers304['Cache-Control'] = `public, max-age=${maxAge}`
      return new Response(null, { status: 304, headers: headers304 })
    }

    let rangeHeader = ctx.req.headers.get('range')
    const ifRange = ctx.req.headers.get('if-range')
    if (rangeHeader && ifRange) {
      const looksLikeETag = ifRange.startsWith('"') || ifRange.startsWith('W/')
      const matches = looksLikeETag ? ifRange.trim() === etag : ifRange.trim() === lastModified
      if (!matches) rangeHeader = null
    }

    const range = parseRange(rangeHeader, stats.size)

    const headers: Record<string, string> = {
      'Content-Type': withCharset(getMimeType(realPath)),
      'Accept-Ranges': 'bytes',
    }
    if (maxAge > 0) headers['Cache-Control'] = `public, max-age=${maxAge}`
    if (etagEnabled) {
      headers.ETag = etag
      headers['Last-Modified'] = lastModified
    }

    if (range === 'unsatisfiable') {
      headers['Content-Range'] = `bytes */${stats.size}`
      return new Response(null, { status: 416, headers })
    }

    let status = 200
    let start = 0
    let end = stats.size === 0 ? 0 : stats.size - 1
    if (range) {
      status = 206
      start = range.start
      end = range.end
      headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`
    }

    const length = stats.size === 0 ? 0 : end - start + 1
    headers['Content-Length'] = String(length)

    if (method === 'HEAD') {
      return new Response(null, { status, headers })
    }

    if (stats.size === 0 && !range) {
      return new Response(null, { status, headers })
    }

    const streamOpts = range ? { start, end } : undefined
    const stream = Readable.toWeb(createReadStream(realPath, streamOpts)) as unknown as ReadableStream
    return new Response(stream, { status, headers })
  }

  return async (ctx: RequestContext): Promise<Response> => {
    let relativePath = ctx.params['*']

    if (!relativePath) {
      if (!index) {
        throw new NotFoundException(`Cannot GET ${ctx.req.url}`)
      }

      // Redirect to trailing slash so relative paths in HTML resolve correctly
      const url = new URL(ctx.req.url)
      if (!url.pathname.endsWith('/')) {
        url.pathname += '/'
        return Response.redirect(url.toString(), 301)
      }

      relativePath = index
    }

    // Dotfile guard - hard 404, no SPA fallback (so a request to /.git/HEAD
    // can't slip through to index.html when fallback is configured).
    if (!dotfiles && containsDotSegment(relativePath)) {
      throw new NotFoundException(`Cannot GET ${ctx.req.url}`)
    }

    const response = await serveFile(ctx, relativePath)
    if (response) return response

    if (fallback !== false) {
      const accept = ctx.req.headers.get('accept')
      if (shouldFallback(ctx.req.method, accept, relativePath)) {
        const fallbackResponse = await serveFile(ctx, fallback)
        if (fallbackResponse) return fallbackResponse
      }
    }

    throw new NotFoundException(`Cannot GET ${ctx.req.url}`)
  }
}

export function serveStatic(app: Miia, prefix: string, root: string, options?: ServeStaticOptions): void {
  app.addRoute('GET', `${prefix}/*`, createStaticHandler(root, options))
}
