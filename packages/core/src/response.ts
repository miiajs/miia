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
