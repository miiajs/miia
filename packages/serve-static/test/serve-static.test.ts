import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Miia } from '@miiajs/core'
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

  writeFileSync(join(tmpRoot, 'index.html'), '<!doctype html><title>home</title>')
  writeFileSync(join(tmpRoot, 'styles.css'), 'body { color: red }')
  writeFileSync(join(tmpRoot, 'data.json'), '{"ok":true}')
  writeFileSync(join(tmpRoot, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(tmpRoot, 'archive.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]))
  writeFileSync(join(tmpRoot, 'empty.bin'), '')

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
