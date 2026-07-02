import type { ResponseBuilder } from './response.js'

// ─── Cookie Options ──────────────────────────────────────────────

export interface CookieOptions {
  /** Cookie `Domain` attribute. Validated against header-injection characters. */
  domain?: string
  /** Cookie `Path` attribute. Validated against header-injection characters. */
  path?: string
  /** Cookie `Expires` attribute (absolute date). */
  expires?: Date
  /**
   * Cookie `Max-Age` attribute, **in seconds**. Emitted whenever defined, so
   * `maxAge: 0` (expire immediately) is preserved.
   */
  maxAge?: number
  /** Cookie `HttpOnly` attribute - inaccessible to `document.cookie`. */
  httpOnly?: boolean
  /**
   * Cookie `Secure` attribute. Auto-enabled when `sameSite` is `'none'` and
   * `secure` is undefined; an explicit `secure: false` with `sameSite: 'none'`
   * throws a `TypeError`.
   */
  secure?: boolean
  /** Cookie `SameSite` attribute. */
  sameSite?: 'strict' | 'lax' | 'none'
  /** Cookie `Priority` attribute (Chromium extension). */
  priority?: 'low' | 'medium' | 'high'
  /** Cookie `Partitioned` attribute (CHIPS). */
  partitioned?: boolean
}

// ─── Validation ──────────────────────────────────────────────────

// RFC 6265 cookie-name token: no control chars, spaces, or separators.
const NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
// Reject CR, LF, semicolons, and control chars in attribute values to prevent
// Set-Cookie header injection.
const ATTR_INJECTION_RE = /[\x00-\x1F\x7F;]/

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Serialize a cookie name/value pair plus attributes into a `Set-Cookie` string.
 *
 * Low-level primitive: it does **not** default `path` - that default (`'/'`)
 * lives in `ResponseBuilder.cookie()`. The value is `encodeURIComponent`-encoded.
 *
 * @param name Cookie name, validated as an RFC 6265 token.
 * @param value Cookie value, URI-encoded automatically.
 * @param options Cookie attributes. `maxAge` is in **seconds**.
 * @throws {TypeError} If `name` is not a valid token, `path`/`domain` contains
 *   CR/LF, `;`, or control characters, `maxAge` is not finite, `expires` is
 *   an invalid `Date`, `sameSite` is `'none'` with an explicit `secure: false`,
 *   or `partitioned` is set without a resolved `Secure`.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!NAME_RE.test(name)) {
    throw new TypeError(`Invalid cookie name: ${JSON.stringify(name)}`)
  }

  let str = `${name}=${encodeURIComponent(value)}`

  if (options.domain !== undefined) {
    if (ATTR_INJECTION_RE.test(options.domain)) {
      throw new TypeError(`Invalid cookie domain: ${JSON.stringify(options.domain)}`)
    }
    str += `; Domain=${options.domain}`
  }

  if (options.path !== undefined) {
    if (ATTR_INJECTION_RE.test(options.path)) {
      throw new TypeError(`Invalid cookie path: ${JSON.stringify(options.path)}`)
    }
    str += `; Path=${options.path}`
  }

  if (options.expires !== undefined) {
    if (Number.isNaN(options.expires.getTime())) {
      throw new TypeError(`Invalid cookie expires: ${JSON.stringify(options.expires)}`)
    }
    str += `; Expires=${options.expires.toUTCString()}`
  }

  // `!== undefined` (not truthy) so a legitimate `maxAge: 0` is not dropped.
  if (options.maxAge !== undefined) {
    if (!Number.isFinite(options.maxAge)) {
      throw new TypeError(`Invalid cookie max-age: ${JSON.stringify(options.maxAge)}`)
    }
    str += `; Max-Age=${Math.floor(options.maxAge)}`
  }

  if (options.httpOnly) {
    str += '; HttpOnly'
  }

  // Browsers reject SameSite=None cookies without Secure, so an explicit
  // `secure: false` here would silently produce a cookie the browser discards.
  if (options.sameSite === 'none' && options.secure === false) {
    throw new TypeError('SameSite=None requires Secure; remove secure: false or use a different sameSite')
  }

  // Auto-enable Secure for SameSite=None, which browsers require.
  const secure = options.secure ?? (options.sameSite === 'none' ? true : undefined)

  // Partitioned (CHIPS) cookies are only valid with Secure.
  if (options.partitioned && !secure) {
    throw new TypeError('Partitioned requires Secure; set secure: true')
  }

  if (secure) {
    str += '; Secure'
  }

  if (options.partitioned) {
    str += '; Partitioned'
  }

  if (options.priority !== undefined) {
    str += `; Priority=${capitalize(options.priority)}`
  }

  if (options.sameSite !== undefined) {
    str += `; SameSite=${capitalize(options.sameSite)}`
  }

  return str
}

// ─── Parsing ─────────────────────────────────────────────────────

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Parse a `Cookie` request header into a name -> value map. Values are
 * URI-decoded (falling back to the raw value on malformed input) and surrounding
 * double quotes are stripped. On duplicate names, the first occurrence wins.
 *
 * The returned object has a null prototype, so cookie names that collide with
 * `Object.prototype` members (`toString`, `constructor`, `__proto__`, ...) are
 * stored and read as honest own properties.
 */
export function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  if (!header) return out

  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue

    const name = pair.slice(0, eq).trim()
    if (!name || name in out) continue // first-wins on duplicates

    let value = pair.slice(eq + 1).trim()
    if (value.length >= 2 && value.charCodeAt(0) === 0x22 && value.charCodeAt(value.length - 1) === 0x22) {
      value = value.slice(1, -1)
    }
    out[name] = safeDecode(value)
  }

  return out
}

// ─── Cookie Jar ──────────────────────────────────────────────────

/**
 * Ergonomic accessor for request cookies (read) and response cookies (write).
 * Exposed on `RequestContext` as the lazy `ctx.cookies` getter. Reads lazily
 * parse the request `Cookie` header and cache the result; writes delegate to the
 * `ResponseBuilder` so `Set-Cookie` headers survive the fast path.
 */
export class CookieJar {
  private readonly req: Request
  private readonly res: ResponseBuilder
  private _parsed: Record<string, string> | null = null

  constructor(req: Request, res: ResponseBuilder) {
    this.req = req
    this.res = res
  }

  private parse(): Record<string, string> {
    return (this._parsed ??= parseCookieHeader(this.req.headers.get('cookie') ?? ''))
  }

  /** Return the value of an incoming cookie, or `undefined` if absent. */
  get(name: string): string | undefined {
    return this.parse()[name]
  }

  /**
   * Return all incoming cookies as a name -> value map. This is a snapshot copy,
   * so mutating the result does not affect the jar's cached state.
   */
  getAll(): Record<string, string> {
    return { ...this.parse() }
  }

  /** Whether an incoming cookie with the given name is present. */
  has(name: string): boolean {
    return name in this.parse()
  }

  /** Set a response cookie (delegates to `ResponseBuilder.cookie()`). */
  set(name: string, value: string, options?: CookieOptions): this {
    this.res.cookie(name, value, options)
    return this
  }

  /** Expire a response cookie (delegates to `ResponseBuilder.deleteCookie()`). */
  delete(name: string, options?: { path?: string; domain?: string }): this {
    this.res.deleteCookie(name, options)
    return this
  }
}
