import type { CookieOptions } from './cookies.js'
import { serializeCookie } from './cookies.js'

export class ResponseBuilder {
  private _status = 200
  private _headers: Headers | null = null
  private _body: BodyInit | null = null
  /** @internal */
  _modified = false

  private ensureHeaders(): Headers {
    return (this._headers ??= new Headers())
  }

  status(code: number): this {
    this._modified = true
    this._status = code
    return this
  }

  header(name: string, value: string): this {
    this._modified = true
    this.ensureHeaders().set(name, value)
    return this
  }

  json(data: unknown): this {
    this._modified = true
    this.ensureHeaders().set('Content-Type', 'application/json')
    this._body = JSON.stringify(data)
    return this
  }

  text(data: string): this {
    this._modified = true
    this.ensureHeaders().set('Content-Type', 'text/plain')
    this._body = data
    return this
  }

  html(data: string): this {
    this._modified = true
    this.ensureHeaders().set('Content-Type', 'text/html')
    this._body = data
    return this
  }

  /**
   * Append a `Set-Cookie` header. Uses `append` (not `set`) so multiple cookies
   * accumulate, and marks the response modified so the fast path does not drop
   * headers. Defaults `path` to `'/'`. `options.maxAge` is in **seconds**.
   */
  cookie(name: string, value: string, options?: CookieOptions): this {
    this._modified = true
    this.ensureHeaders().append('Set-Cookie', serializeCookie(name, value, { path: '/', ...options }))
    return this
  }

  /** Expire a cookie by setting an epoch `Expires` and `Max-Age=0`. Defaults `path` to `'/'`. */
  deleteCookie(name: string, options?: { path?: string; domain?: string }): this {
    return this.cookie(name, '', { ...options, path: options?.path ?? '/', expires: new Date(0), maxAge: 0 })
  }

  redirect(url: string, status = 302): this {
    this._modified = true
    this._status = status
    this.ensureHeaders().set('Location', url)
    return this
  }

  stream(readable: ReadableStream): this {
    this._modified = true
    this._body = readable
    return this
  }

  build(): Response {
    return new Response(this._body, {
      status: this._status,
      headers: this._headers ?? undefined,
    })
  }

  getStatus(): number {
    return this._status
  }

  getHeaders(): Headers {
    return this.ensureHeaders()
  }
}
