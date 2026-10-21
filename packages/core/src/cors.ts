import type { ResponseBuilder } from './response.js'
import type { Middleware } from './types.js'

export interface CorsOptions {
  /**
   * Allowed origin(s). Pass `'*'` to allow any origin (cannot be combined with
   * `credentials: true`), a specific string, an array of allowed strings, or a
   * predicate function.
   *
   * **Security note for function form:** the callback receives the raw `Origin`
   * header - validate the full origin string, not just a suffix. Naive checks
   * like `o.endsWith('.example.com')` are bypassed by `evil.example.com.attacker.net`.
   * Prefer comparing against a whitelist or parsing with `new URL(origin)` and
   * checking `.hostname` exactly.
   */
  origin?: string | string[] | ((origin: string) => boolean)
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
}

export function cors(options: CorsOptions = {}): Middleware {
  const {
    origin = '*',
    methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders = ['Content-Type', 'Authorization'],
    exposedHeaders = [],
    credentials = false,
    maxAge = 86400,
  } = options

  // Fail fast on a configuration the CORS spec forbids. Some proxies/CDNs would
  // happily cache the response, turning it into a reflection vulnerability.
  if (credentials && origin === '*') {
    throw new Error(
      "cors: 'credentials: true' is incompatible with 'origin: \"*\"'. " +
        'Provide explicit origin(s) or a predicate function.',
    )
  }

  // Dynamic origin requires Vary header for correct CDN/proxy caching - on a
  // refused or missing Origin too, or a cache hands that answer to an allowed origin
  const varies = origin !== '*'

  return async (ctx, next) => {
    const requestOrigin = ctx.req.headers.get('origin') ?? ''

    // Determine allowed origin
    let allowOrigin = '*'
    if (typeof origin === 'string') {
      allowOrigin = origin
    } else if (Array.isArray(origin)) {
      allowOrigin = origin.includes(requestOrigin) ? requestOrigin : ''
    } else if (typeof origin === 'function') {
      allowOrigin = origin(requestOrigin) ? requestOrigin : ''
    }

    if (varies) varyOnOrigin(ctx.res)

    if (!allowOrigin) {
      await next()
      return
    }

    ctx.res.header('Access-Control-Allow-Origin', allowOrigin)

    if (credentials) {
      ctx.res.header('Access-Control-Allow-Credentials', 'true')
    }

    if (exposedHeaders.length > 0) {
      ctx.res.header('Access-Control-Expose-Headers', exposedHeaders.join(', '))
    }

    // Preflight, as the Fetch spec defines it: any other OPTIONS goes on to its route
    if (ctx.req.method === 'OPTIONS' && requestOrigin && ctx.req.headers.has('access-control-request-method')) {
      ctx.res.header('Access-Control-Allow-Methods', methods.join(', '))
      ctx.res.header('Access-Control-Allow-Headers', allowedHeaders.join(', '))
      ctx.res.header('Access-Control-Max-Age', String(maxAge))
      ctx.res.status(204)
      return
    }

    await next()
  }
}

/** Adds `Origin` to the `Vary` an earlier middleware may have set, instead of replacing it. */
function varyOnOrigin(res: ResponseBuilder): void {
  const vary = res.getHeaders().get('vary')
  if (vary === null) {
    res.header('Vary', 'Origin')
    return
  }
  const names = vary.split(',').map((name) => name.trim().toLowerCase())
  if (names.includes('*') || names.includes('origin')) return
  res.header('Vary', `${vary}, Origin`)
}
