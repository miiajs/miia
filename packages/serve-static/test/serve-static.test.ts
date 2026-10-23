import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Miia, NotFoundException } from '@miiajs/core'
import { type ServeStaticOptions, serveStatic } from '../src/index.js'

let base: string
let tmpRoot: string
let secretDir: string
let bigFileSize: number

let defaultApp: Miia
let cacheApp: Miia
let noEtagApp: Miia
let noIndexApp: Miia
let dotfilesApp: Miia
let fallbackApp: Miia
let dotfilesFallbackApp: Miia
let prefixedApp: Miia
let spaOutsidePrefixApp: Miia
let prefixedWildcard: string | undefined
let spaRoot: string

async function makeApp(root: string, options?: ServeStaticOptions): Promise<Miia> {
  const app = new Miia({ logger: false })
  serveStatic(app, '/static', root, options)
  await app.init()
  return app
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'miia-static-'))
  tmpRoot = join(base, 'public')
  secretDir = join(base, 'secret')
  spaRoot = join(base, 'spa')

  mkdirSync(tmpRoot)
  mkdirSync(secretDir)
  mkdirSync(spaRoot)
  mkdirSync(join(tmpRoot, '.well-known'))
  mkdirSync(join(tmpRoot, 'foo'))
  mkdirSync(join(tmpRoot, 'foo', '.git'))

  writeFileSync(join(tmpRoot, 'hello.txt'), 'hello world')
  writeFileSync(join(secretDir, 'passwd'), 'root:x:0:0')
  symlinkSync(join(secretDir, 'passwd'), join(tmpRoot, 'escape.txt'))
  // A sibling whose name starts with the root's, with a link back into the root
  mkdirSync(join(base, 'public2'))
  symlinkSync(join(tmpRoot, 'hello.txt'), join(base, 'public2', 'back.txt'))

  writeFileSync(join(tmpRoot, 'index.html'), '<!doctype html><title>home</title>')
  writeFileSync(join(tmpRoot, 'styles.css'), 'body { color: red }')
  writeFileSync(join(tmpRoot, 'data.json'), '{"ok":true}')
  writeFileSync(join(tmpRoot, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(tmpRoot, 'archive.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]))
  writeFileSync(join(tmpRoot, 'empty.bin'), '')
  writeFileSync(join(tmpRoot, 'hello world.txt'), 'space')
  mkdirSync(join(tmpRoot, 'docs'))
  writeFileSync(join(tmpRoot, 'docs', 'index.html'), '<title>docs</title>')
  mkdirSync(join(tmpRoot, 'bare'))
  writeFileSync(join(tmpRoot, 'bare', 'file.txt'), 'bare')
  mkdirSync(join(spaRoot, 'assets'))
  writeFileSync(join(spaRoot, 'assets', 'app.css'), 'body{}')
  writeFileSync(join(tmpRoot, 'ünï.txt'), 'unicode')

  // 1000-byte file with known content for Range tests
  const bigContent = '0123456789'.repeat(100)
  writeFileSync(join(tmpRoot, 'big.bin'), bigContent)
  bigFileSize = statSync(join(tmpRoot, 'big.bin')).size

  writeFileSync(join(tmpRoot, '.env'), 'SECRET=1')
  writeFileSync(join(tmpRoot, '.well-known', 'foo.txt'), 'wk')
  writeFileSync(join(tmpRoot, 'foo', '.git', 'HEAD'), 'ref: refs/heads/main')

  writeFileSync(join(spaRoot, 'index.html'), '<!doctype html><title>spa</title>')
  writeFileSync(join(spaRoot, 'app.js'), 'console.log(1)')

  defaultApp = await makeApp(tmpRoot)
  cacheApp = await makeApp(tmpRoot, { maxAge: 3600 })
  noEtagApp = await makeApp(tmpRoot, { etag: false })
  noIndexApp = await makeApp(tmpRoot, { index: false })
  dotfilesApp = await makeApp(tmpRoot, { dotfiles: true })
  fallbackApp = await makeApp(spaRoot, { fallback: 'index.html' })
  dotfilesFallbackApp = await makeApp(tmpRoot, { fallback: 'index.html' })

  prefixedApp = new Miia({ logger: false, globalPrefix: '/api' })
  prefixedApp.use(async (ctx, next) => {
    await next()
    prefixedWildcard = ctx.params['*']
  })
  serveStatic(prefixedApp, '/static', tmpRoot)
  await prefixedApp.init()

  spaOutsidePrefixApp = new Miia({ logger: false, globalPrefix: '/api' })
  spaOutsidePrefixApp.addRoute('GET', '/users', () => ({ ok: true }))
  serveStatic(spaOutsidePrefixApp, '/', spaRoot, { fallback: 'index.html', skipGlobalPrefix: true })
  await spaOutsidePrefixApp.init()
})

afterAll(async () => {
  await Promise.all([
    defaultApp?.destroy(),
    cacheApp?.destroy(),
    noEtagApp?.destroy(),
    noIndexApp?.destroy(),
    dotfilesApp?.destroy(),
    fallbackApp?.destroy(),
    dotfilesFallbackApp?.destroy(),
    prefixedApp?.destroy(),
    spaOutsidePrefixApp?.destroy(),
  ])
  try {
    rmSync(base, { recursive: true, force: true })
  } catch {}
})

describe('serve-static - symlink escape', () => {
  it('serves a real file inside root', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/hello.txt'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello world')
  })

  it('returns 404 for a symlink pointing outside the root', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/escape.txt'))
    expect(res.status).toBe(404)
  })

  it('returns 404 for traversal attempts', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/../../etc/passwd'))
    expect(res.status).toBe(404)
  })

  it('returns 404 for a missing file', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/nope.txt'))
    expect(res.status).toBe(404)
  })

  it('words the 404 like the router: method and path, no host', async () => {
    const res = await defaultApp.fetch(new Request('http://evil.example/static/nope.txt'))
    expect((await res.json()).message).toBe('Cannot GET /static/nope.txt')
    const head = await noIndexApp.fetch(new Request('http://localhost/static', { method: 'HEAD' }))
    expect(head.status).toBe(404)
    expect((await defaultApp.fetch(new Request('http://localhost/static/.env'))).status).toBe(404)
  })
})

describe('serve-static - percent-encoded paths', () => {
  it('serves a file whose name has a space', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/hello%20world.txt'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('space')
  })

  it('serves a file with a non-ASCII name', async () => {
    const res = await defaultApp.fetch(new Request(`http://localhost/static/${encodeURIComponent('ünï.txt')}`))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('unicode')
  })

  it('answers 400 to malformed percent-encoding and an encoded NUL', async () => {
    expect((await defaultApp.fetch(new Request('http://localhost/static/%E0%A4%A'))).status).toBe(400)
    expect((await defaultApp.fetch(new Request('http://localhost/static/a%00.txt'))).status).toBe(400)
  })

  it('checks dot segments and traversal on the decoded path', async () => {
    expect((await defaultApp.fetch(new Request('http://localhost/static/..%2fsecret%2fpasswd'))).status).toBe(404)
    expect((await dotfilesApp.fetch(new Request('http://localhost/static/..%2fsecret%2fpasswd'))).status).toBe(404)
    expect((await defaultApp.fetch(new Request('http://localhost/static/foo%2f.git%2fHEAD'))).status).toBe(404)
    expect((await defaultApp.fetch(new Request('http://localhost/static/%2eenv'))).status).toBe(404)
  })

  it('turns a sibling directory that starts with the root name away on the path alone', async () => {
    // public2/back.txt resolves into the root, so the realpath check alone would serve it
    const res = await dotfilesApp.fetch(new Request('http://localhost/static/..%2fpublic2%2fback.txt'))
    expect(res.status).toBe(404)
  })

  it('reads an encoded slash as a path separator inside root', async () => {
    const res = await dotfilesApp.fetch(new Request('http://localhost/static/.well-known%2Ffoo.txt'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('wk')
  })
})

describe('serve-static - index serving + redirects', () => {
  it('serves index.html at /static/', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('<title>home</title>')
  })

  it('redirects /static to /static/ with 301', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('http://localhost/static/')
  })

  it('returns 404 for /static when index is disabled', async () => {
    const res = await noIndexApp.fetch(new Request('http://localhost/static'))
    expect(res.status).toBe(404)
  })

  it('serves the index file of a subdirectory', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/docs/'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<title>docs</title>')
  })

  it('redirects a subdirectory without the trailing slash, keeping the query', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/docs?v=1'))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('http://localhost/static/docs/?v=1')
  })

  it('answers 404 for a subdirectory without an index file', async () => {
    expect((await defaultApp.fetch(new Request('http://localhost/static/bare'))).status).toBe(404)
    expect((await defaultApp.fetch(new Request('http://localhost/static/bare/'))).status).toBe(404)
  })

  it('leaves subdirectories alone when index is disabled', async () => {
    expect((await noIndexApp.fetch(new Request('http://localhost/static/docs/'))).status).toBe(404)
  })

  it('falls back to the SPA for a directory without an index file', async () => {
    const res = await fallbackApp.fetch(
      new Request('http://localhost/static/assets', { headers: { accept: 'text/html' } }),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>spa</title>')
  })
})

/** A raw request with an invalid Host: Bun hands it to fetch with a relative `req.url`. */
async function rawGet(port: number, path: string): Promise<{ status: number; location: string | null; body: string }> {
  const raw = await new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: x/y\r\nConnection: close\r\n\r\n`)
    })
    let out = ''
    socket.on('data', (chunk) => {
      out += chunk
    })
    socket.on('end', () => resolve(out))
    socket.on('error', reject)
  })
  const [head = '', body = ''] = raw.split('\r\n\r\n')
  const location = /^location: (.*)$/im.exec(head)?.[1] ?? null
  return { status: Number(head.split(' ')[1]), location, body }
}

describe('serve-static - a request url that is not a URL on its own (invalid Host)', () => {
  it('Bun, relative url: serves, redirects and answers 404 as usual', async () => {
    const rootApp = new Miia({ logger: false })
    serveStatic(rootApp, '', tmpRoot)
    await rootApp.init()
    const server = Bun.serve({ port: 0, fetch: defaultApp.fetch })
    const rootServer = Bun.serve({ port: 0, fetch: rootApp.fetch })
    try {
      const file = await rawGet(server.port!, '/static/hello.txt')
      expect(file.status).toBe(200)
      expect(file.body).toContain('hello world')

      const missing = await rawGet(server.port!, '/static/nope.txt')
      expect(missing.status).toBe(404)
      expect(missing.body).toContain('"Cannot GET /static/nope.txt"')

      expect(await rawGet(server.port!, '/static')).toMatchObject({ status: 301, location: '/static/' })
      expect(await rawGet(server.port!, '/static/docs?v=1')).toMatchObject({
        status: 301,
        location: '/static/docs/?v=1',
      })
      expect((await rawGet(server.port!, '/static/docs/')).body).toContain('<title>docs</title>')
      // Never a protocol-relative Location
      expect(await rawGet(rootServer.port!, '//docs')).toMatchObject({ status: 301, location: '/docs/' })
    } finally {
      server.stop(true)
      rootServer.stop(true)
      await rootApp.destroy()
    }
  })

  it('reads the path of an absolute url with a Host that makes no URL (node-server)', async () => {
    const req = (url: string) => ({ url, method: 'GET', headers: new Headers() }) as Request
    const file = await defaultApp.fetch(req('http://x:99999/static/hello.txt'))
    expect(await file.text()).toBe('hello world')
    const missing = await defaultApp.fetch(req('http://x:99999/static/nope.txt'))
    expect((await missing.json()).message).toBe('Cannot GET /static/nope.txt')
    const redirect = await defaultApp.fetch(req('http://x:99999/static/docs?v=1'))
    expect(redirect.status).toBe(301)
    expect(redirect.headers.get('location')).toBe('/static/docs/?v=1')
  })
})

describe('serve-static - Cache-Control', () => {
  it('omits Cache-Control by default', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/hello.txt'))
    expect(res.headers.get('cache-control')).toBeNull()
  })

  it('sets Cache-Control when maxAge is provided', async () => {
    const res = await cacheApp.fetch(new Request('http://localhost/static/hello.txt'))
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })
})

describe('serve-static - Content-Type + charset', () => {
  it('appends utf-8 charset for text/html', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/index.html'))
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
  })

  it('appends utf-8 charset for application/json', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/data.json'))
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
  })

  it('does not append charset to image/png', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/logo.png'))
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  it('returns application/octet-stream for unknown extension', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/archive.bin'))
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
  })
})

describe('serve-static - HEAD method', () => {
  it('returns headers without body for HEAD', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/hello.txt', { method: 'HEAD' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('11')
    expect(await res.text()).toBe('')
  })

  it('returns 206 headers without body for HEAD with Range', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', {
        method: 'HEAD',
        headers: { Range: 'bytes=0-99' },
      }),
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-99/${bigFileSize}`)
    expect(res.headers.get('content-length')).toBe('100')
    expect(await res.text()).toBe('')
  })
})

describe('serve-static - ETag + 304', () => {
  it('returns ETag in W/"hex-hex" format', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/hello.txt'))
    const etag = res.headers.get('etag')
    expect(etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/)
  })

  it('returns 304 when If-None-Match matches', async () => {
    const first = await defaultApp.fetch(new Request('http://localhost/static/hello.txt'))
    const etag = first.headers.get('etag')!

    const second = await defaultApp.fetch(
      new Request('http://localhost/static/hello.txt', { headers: { 'If-None-Match': etag } }),
    )
    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
  })

  it('returns 200 when If-None-Match does not match', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/hello.txt', {
        headers: { 'If-None-Match': 'W/"deadbeef-1"' },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('treats * in If-None-Match as match', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/hello.txt', { headers: { 'If-None-Match': '*' } }),
    )
    expect(res.status).toBe(304)
  })

  it('omits ETag when etag option is false', async () => {
    const res = await noEtagApp.fetch(new Request('http://localhost/static/hello.txt'))
    expect(res.headers.get('etag')).toBeNull()
    expect(res.headers.get('last-modified')).toBeNull()
  })

  it('ignores If-None-Match and If-Modified-Since when etag is disabled', async () => {
    const first = await defaultApp.fetch(new Request('http://localhost/static/hello.txt'))
    const etag = first.headers.get('etag')!
    const lm = first.headers.get('last-modified')!

    const byEtag = await noEtagApp.fetch(
      new Request('http://localhost/static/hello.txt', { headers: { 'If-None-Match': etag } }),
    )
    expect(byEtag.status).toBe(200)
    expect(await byEtag.text()).toBe('hello world')
    const byDate = await noEtagApp.fetch(
      new Request('http://localhost/static/hello.txt', { headers: { 'If-Modified-Since': lm } }),
    )
    expect(byDate.status).toBe(200)
  })
})

describe('serve-static - Last-Modified + If-Modified-Since', () => {
  it('returns 304 when If-Modified-Since equals Last-Modified (boundary)', async () => {
    const first = await defaultApp.fetch(new Request('http://localhost/static/hello.txt'))
    const lm = first.headers.get('last-modified')!

    const second = await defaultApp.fetch(
      new Request('http://localhost/static/hello.txt', { headers: { 'If-Modified-Since': lm } }),
    )
    expect(second.status).toBe(304)
  })

  it('returns 304 when If-Modified-Since is 1s after mtime', async () => {
    const first = await defaultApp.fetch(new Request('http://localhost/static/hello.txt'))
    const lm = first.headers.get('last-modified')!
    const later = new Date(Date.parse(lm) + 1000).toUTCString()

    const second = await defaultApp.fetch(
      new Request('http://localhost/static/hello.txt', { headers: { 'If-Modified-Since': later } }),
    )
    expect(second.status).toBe(304)
  })

  it('returns 200 when If-Modified-Since is 1s before mtime', async () => {
    const first = await defaultApp.fetch(new Request('http://localhost/static/hello.txt'))
    const lm = first.headers.get('last-modified')!
    const earlier = new Date(Date.parse(lm) - 1000).toUTCString()

    const second = await defaultApp.fetch(
      new Request('http://localhost/static/hello.txt', { headers: { 'If-Modified-Since': earlier } }),
    )
    expect(second.status).toBe(200)
  })
})

describe('serve-static - If-Range', () => {
  it('serves 206 when If-Range matches ETag', async () => {
    const first = await defaultApp.fetch(new Request('http://localhost/static/big.bin'))
    const etag = first.headers.get('etag')!

    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', {
        headers: { Range: 'bytes=0-9', 'If-Range': etag },
      }),
    )
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('0123456789')
  })

  it('serves 200 full when If-Range does not match ETag', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', {
        headers: { Range: 'bytes=0-9', 'If-Range': 'W/"deadbeef-0"' },
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.length).toBe(bigFileSize)
  })

  it('serves 206 when If-Range matches Last-Modified', async () => {
    const first = await defaultApp.fetch(new Request('http://localhost/static/big.bin'))
    const lm = first.headers.get('last-modified')!

    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', {
        headers: { Range: 'bytes=0-9', 'If-Range': lm },
      }),
    )
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('0123456789')
  })
})

describe('serve-static - Range requests', () => {
  it('serves 206 with explicit start-end range', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', { headers: { Range: 'bytes=0-99' } }),
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-99/${bigFileSize}`)
    expect(res.headers.get('content-length')).toBe('100')
    const body = await res.text()
    expect(body.length).toBe(100)
    expect(body.slice(0, 10)).toBe('0123456789')
  })

  it('serves 206 with open-ended range bytes=N-', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', { headers: { Range: 'bytes=900-' } }),
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 900-${bigFileSize - 1}/${bigFileSize}`)
    const body = await res.text()
    expect(body.length).toBe(100)
  })

  it('serves 206 with suffix range bytes=-N', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', { headers: { Range: 'bytes=-50' } }),
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes ${bigFileSize - 50}-${bigFileSize - 1}/${bigFileSize}`)
    const body = await res.text()
    expect(body.length).toBe(50)
  })

  it('returns 416 when range is unsatisfiable', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', { headers: { Range: 'bytes=2000-3000' } }),
    )
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe(`bytes */${bigFileSize}`)
  })

  it('ignores malformed Range and returns 200 full', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', { headers: { Range: 'bytes=abc' } }),
    )
    expect(res.status).toBe(200)
  })

  it('ignores multi-range and returns 200 full', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', { headers: { Range: 'bytes=0-10,20-30' } }),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body.length).toBe(bigFileSize)
  })

  it('exposes Accept-Ranges on 200', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/hello.txt'))
    expect(res.headers.get('accept-ranges')).toBe('bytes')
  })

  it('exposes Accept-Ranges on 206', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/big.bin', { headers: { Range: 'bytes=0-9' } }),
    )
    expect(res.headers.get('accept-ranges')).toBe('bytes')
  })

  it('returns 416 for bytes=0-0 on empty file', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/empty.bin', { headers: { Range: 'bytes=0-0' } }),
    )
    expect(res.status).toBe(416)
  })

  it('returns 200 with empty body for bytes=0- on empty file', async () => {
    const res = await defaultApp.fetch(
      new Request('http://localhost/static/empty.bin', { headers: { Range: 'bytes=0-' } }),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
})

describe('serve-static - Dotfiles', () => {
  it('returns 404 for top-level dotfile by default', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/.env'))
    expect(res.status).toBe(404)
  })

  it('returns 404 for .well-known by default', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/.well-known/foo.txt'))
    expect(res.status).toBe(404)
  })

  it('returns 404 for nested dotfile segment by default', async () => {
    const res = await defaultApp.fetch(new Request('http://localhost/static/foo/.git/HEAD'))
    expect(res.status).toBe(404)
  })

  it('serves dotfiles when dotfiles option is true', async () => {
    const res = await dotfilesApp.fetch(new Request('http://localhost/static/.env'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('SECRET=1')
  })

  it('does not fall back to index.html for dotfile-blocked path', async () => {
    const res = await dotfilesFallbackApp.fetch(
      new Request('http://localhost/static/.git/HEAD', { headers: { Accept: 'text/html' } }),
    )
    expect(res.status).toBe(404)
  })

  it('throws at startup when fallback path contains a dotfile and dotfiles are disabled', async () => {
    expect(() => {
      const tmp = new Miia({ logger: false })
      serveStatic(tmp, '/x', tmpRoot, { fallback: '.well-known/foo.html' })
    }).toThrow(/dotfile/)
  })
})

describe('serve-static - global prefix', () => {
  it('serves under the app-level global prefix without touching the wildcard param', async () => {
    const res = await prefixedApp.fetch(new Request('http://localhost/api/static/hello.txt'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello world')
    expect(prefixedWildcard).toBe('hello.txt')

    const unprefixed = await prefixedApp.fetch(new Request('http://localhost/static/hello.txt'))
    expect(unprefixed.status).toBe(404)
  })

  it('keeps the mount at the root with skipGlobalPrefix while the API stays prefixed', async () => {
    const root = await spaOutsidePrefixApp.fetch(new Request('http://localhost/'))
    expect(root.status).toBe(200)
    expect(await root.text()).toContain('<title>spa</title>')

    const deepLink = await spaOutsidePrefixApp.fetch(
      new Request('http://localhost/about', { headers: { Accept: 'text/html' } }),
    )
    expect(deepLink.status).toBe(200)
    expect(await deepLink.text()).toContain('<title>spa</title>')

    const api = await spaOutsidePrefixApp.fetch(new Request('http://localhost/api/users'))
    expect(api.status).toBe(200)
    expect(await api.json()).toEqual({ ok: true })
  })

  it('lets an unknown API path fall through to the root mount', async () => {
    const unknown = await spaOutsidePrefixApp.fetch(
      new Request('http://localhost/api/nope', { headers: { Accept: '*/*' } }),
    )
    expect(unknown.status).toBe(200)
    expect(await unknown.text()).toContain('<title>spa</title>')

    const json = await spaOutsidePrefixApp.fetch(
      new Request('http://localhost/api/nope', { headers: { Accept: 'application/json' } }),
    )
    expect(json.status).toBe(404)
  })

  it('keeps unknown API paths 404 with a catch-all under the prefix', async () => {
    const app = new Miia({ logger: false, globalPrefix: '/api' })
    app.addRoute('GET', '/users', () => ({ ok: true }))
    app.addRoute(
      'GET',
      '/*',
      () => {
        throw new NotFoundException()
      },
      { skipGlobalGuards: true },
    )
    serveStatic(app, '/', spaRoot, { fallback: 'index.html', skipGlobalPrefix: true })
    await app.init()

    try {
      for (const path of ['/api', '/api/nope', '/api/users/42']) {
        const res = await app.fetch(new Request(`http://localhost${path}`, { headers: { Accept: '*/*' } }))
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Not Found' })
      }

      const deepLink = await app.fetch(new Request('http://localhost/about', { headers: { Accept: 'text/html' } }))
      expect(await deepLink.text()).toContain('<title>spa</title>')
      expect(await (await app.fetch(new Request('http://localhost/api/users'))).json()).toEqual({ ok: true })
    } finally {
      await app.destroy()
    }
  })
})

describe('serve-static - SPA fallback', () => {
  it('serves index.html for no-extension path with text/html Accept', async () => {
    const res = await fallbackApp.fetch(
      new Request('http://localhost/static/about', { headers: { Accept: 'text/html' } }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('<title>spa</title>')
  })

  it('returns 404 for missing asset with extension', async () => {
    const res = await fallbackApp.fetch(
      new Request('http://localhost/static/missing.png', { headers: { Accept: 'text/html' } }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when Accept does not include text/html or */*', async () => {
    const res = await fallbackApp.fetch(
      new Request('http://localhost/static/api/users', { headers: { Accept: 'application/json' } }),
    )
    expect(res.status).toBe(404)
  })

  it('falls back when Accept is */*', async () => {
    const res = await fallbackApp.fetch(new Request('http://localhost/static/about', { headers: { Accept: '*/*' } }))
    expect(res.status).toBe(200)
  })

  it('serves real asset normally when present', async () => {
    const res = await fallbackApp.fetch(new Request('http://localhost/static/app.js'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/javascript')
  })

  it('returns 404 when fallback file itself is missing', async () => {
    const missingFallbackApp = await makeApp(tmpRoot, { fallback: 'nonexistent.html' })
    const res = await missingFallbackApp.fetch(
      new Request('http://localhost/static/about', { headers: { Accept: 'text/html' } }),
    )
    expect(res.status).toBe(404)
    await missingFallbackApp.destroy()
  })

  it('serves fallback for HEAD request without body', async () => {
    const res = await fallbackApp.fetch(
      new Request('http://localhost/static/about', {
        method: 'HEAD',
        headers: { Accept: 'text/html' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
})
