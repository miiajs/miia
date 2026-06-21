import { Controller, Get, type RequestContext, Use } from '@miiajs/core'
import { rateLimit, RateLimit, SkipRateLimit } from '@miiajs/rate-limit'
import { ApiOperation, ApiResponse, ApiTag } from '@miiajs/swagger'

@Controller('limits')
@ApiTag('Rate Limit Demo')
export class LimitsController {
  @Get('global')
  @ApiOperation({
    summary: 'Inherit the global guard',
    description: 'No rate decorator - this route consumes the app-wide guard quota (5 requests / 20s).',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  global() {
    return { ok: true, case: 'global' }
  }

  @Get('strict')
  @ApiOperation({
    summary: 'Per-route replacement',
    description: 'Method-level @RateLimit replaces the global guard for this route (3 requests / 10s).',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @RateLimit({ limit: 3, window: '10s' })
  strict() {
    return { ok: true, case: 'strict' }
  }

  @Get('open')
  @ApiOperation({
    summary: 'Skip the guard layer',
    description: '@SkipRateLimit disables rate limiting on the guard layer (the perimeter middleware still applies).',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @SkipRateLimit()
  open() {
    return { ok: true, case: 'open' }
  }

  @Get('ban')
  @ApiOperation({
    summary: 'Fixed block duration',
    description: 'Once 2 requests / 10s is exceeded, the key is blocked for 30s (fixed ban).',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @RateLimit({ limit: 2, window: '10s', blockDuration: '30s' })
  ban() {
    return { ok: true, case: 'ban' }
  }

  @Get('escalate')
  @ApiOperation({
    summary: 'Geometric block backoff',
    description:
      'Each repeat offence doubles the ban: 4s -> 8s -> 16s (capped at 20s); strikes reset after 60s of quiet.',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded (escalating ban).' })
  @RateLimit({
    limit: 1,
    window: '10s',
    blockDuration: '4s',
    blockBackoff: 2,
    maxBlockDuration: '20s',
    strikeReset: '60s',
  })
  escalate() {
    return { ok: true, case: 'escalate' }
  }

  @Get('key-by-header')
  @ApiOperation({
    summary: 'Custom key generator',
    description: 'Buckets by the x-client-id header (3 requests / 10s), falling back to the client IP.',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @RateLimit({
    limit: 3,
    window: '10s',
    keyGenerator: (ctx) => ctx.req.headers.get('x-client-id') ?? ctx.ip ?? 'unknown',
  })
  keyByHeader() {
    return { ok: true, case: 'key-by-header' }
  }

  @Get('headers-legacy')
  @ApiOperation({
    summary: 'Legacy rate-limit headers',
    description: 'Emits X-RateLimit-* headers instead of the draft-6 RateLimit-* set (3 requests / 10s).',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @RateLimit({ limit: 3, window: '10s', headers: 'legacy' })
  headersLegacy() {
    return { ok: true, case: 'headers-legacy' }
  }

  @Get('headers-off')
  @ApiOperation({
    summary: 'No rate-limit headers',
    description: 'Disables rate-limit headers entirely (only Retry-After on 429) - keeps the response fast path.',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @RateLimit({ limit: 3, window: '10s', headers: false })
  headersOff() {
    return { ok: true, case: 'headers-off' }
  }

  @Get('shared-a')
  @ApiOperation({
    summary: 'Shared bucket (A)',
    description: 'Shares a single 4 requests / 10s bucket with shared-b via an explicit prefix.',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @RateLimit({ limit: 4, window: '10s', prefix: 'limits-shared' })
  sharedA() {
    return { ok: true, case: 'shared-a' }
  }

  @Get('shared-b')
  @ApiOperation({
    summary: 'Shared bucket (B)',
    description: 'Shares a single 4 requests / 10s bucket with shared-a via an explicit prefix.',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @RateLimit({ limit: 4, window: '10s', prefix: 'limits-shared' })
  sharedB() {
    return { ok: true, case: 'shared-b' }
  }

  @Get('stacked')
  @ApiOperation({
    summary: 'Stacked guard + middleware',
    description: 'Guard policy (5/10s) plus a narrower rateLimit() middleware (2/10s) - the middleware trips first.',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @RateLimit({ limit: 5, window: '10s' })
  @Use(rateLimit({ limit: 2, window: '10s', prefix: 'limits-stacked-mw:' }))
  stacked() {
    return { ok: true, case: 'stacked' }
  }
}
