import { Controller, Get, Put, Delete, type RequestContext, serializeCookie, ValidateBody } from '@miiajs/core'
import { SkipRateLimit } from '@miiajs/rate-limit'
import { ApiOperation, ApiResponse, ApiTag } from '@miiajs/swagger'
import { type PrefsInput, PrefsSchema } from './schemas/prefs.schema.js'

@Controller('cookies')
@ApiTag('Cookies')
@SkipRateLimit()
export class CookiesController {
  @Get('/')
  @ApiOperation({
    summary: 'Read all incoming cookies',
    description: 'Returns the parsed request Cookie header as a name -> value map via ctx.cookies.getAll().',
  })
  @ApiResponse(200, { description: 'All cookies sent by the client.' })
  all(ctx: RequestContext) {
    // Demonstrates reading every inbound cookie from the jar.
    return { cookies: ctx.cookies.getAll() }
  }

  @Get('/prefs')
  @ApiOperation({
    summary: 'Read one cookie with a default',
    description: 'Reads the theme cookie, falling back to "light", and reports presence via has().',
  })
  @ApiResponse(200, { description: 'Current theme preference.' })
  readPrefs(ctx: RequestContext) {
    // Demonstrates get() with a default value and has() for presence.
    return { theme: ctx.cookies.get('theme') ?? 'light', present: ctx.cookies.has('theme') }
  }

  @Put('/prefs')
  @ApiOperation({
    summary: 'Persist a preference cookie',
    description: 'Validates the body and writes a 30-day theme cookie while returning a plain JSON object.',
  })
  @ApiResponse(200, { description: 'Preference stored.' })
  @ApiResponse(422, { description: 'Validation failed.' })
  @ValidateBody(PrefsSchema)
  async writePrefs(ctx: RequestContext) {
    const { theme } = await ctx.json<PrefsInput>()
    // Demonstrates a jar write alongside an auto-JSON return (fast-path opt-out).
    ctx.cookies.set('theme', theme, { maxAge: 60 * 60 * 24 * 30, sameSite: 'lax' })
    return { theme }
  }

  @Delete('/prefs')
  @ApiOperation({
    summary: 'Clear a preference cookie',
    description: 'Expires the theme cookie via ctx.cookies.delete().',
  })
  @ApiResponse(200, { description: 'Preference cleared.' })
  clearPrefs(ctx: RequestContext) {
    // Demonstrates deleting a cookie (emits an expired Set-Cookie).
    ctx.cookies.delete('theme')
    return { ok: true }
  }

  @Get('/visits')
  @ApiOperation({
    summary: 'Increment a visit counter',
    description: 'Reads the visits cookie, increments it, and writes it back (set() takes only strings).',
  })
  @ApiResponse(200, { description: 'Updated visit count.' })
  visits(ctx: RequestContext) {
    const n = parseInt(ctx.cookies.get('visits') ?? '0', 10) || 0
    // set() accepts only strings, so stringify the counter.
    ctx.cookies.set('visits', String(n + 1))
    // The freshly written value is NOT visible via get() in the same request -
    // the jar reads only the inbound Cookie header.
    return { visits: n + 1 }
  }

  @Get('/multi')
  @ApiOperation({
    summary: 'Set multiple cookies fluently',
    description: 'Chains ctx.res.cookie() calls to emit several Set-Cookie headers in one response.',
  })
  @ApiResponse(200, { description: 'Multiple cookies set.' })
  multi(ctx: RequestContext) {
    // Demonstrates the fluent chain: multiple Set-Cookie headers plus chainability.
    ctx.res
      .status(200)
      .cookie('a', '1', { sameSite: 'lax' })
      // showcase only - Secure cookies are dropped by browsers over plain http.
      .cookie('b', '2', { httpOnly: true, secure: true, sameSite: 'strict' })
      .json({ ok: true })
  }

  @Get('/raw')
  @ApiOperation({
    summary: 'Set a cookie on a raw Response',
    description: 'Returns a native Response with a manually serialized Set-Cookie header (bypasses ctx.res).',
  })
  @ApiResponse(200, { description: 'Cookie set via a raw Response.' })
  raw() {
    // Demonstrates the low-level serializeCookie primitive on a raw Response,
    // which bypasses ctx.res entirely.
    const res = new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
    res.headers.append('Set-Cookie', serializeCookie('raw', 'yes', { path: '/', sameSite: 'lax' }))
    return res
  }
}
