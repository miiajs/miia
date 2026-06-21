import { Controller, Get } from '@miiajs/core'
import { RateLimit, SkipRateLimit } from '@miiajs/rate-limit'
import { ApiOperation, ApiResponse, ApiTag } from '@miiajs/swagger'

@Controller('limits/class')
@ApiTag('Rate Limit Demo')
@RateLimit({ limit: 6, window: '20s' })
export class LimitsClassController {
  @Get('a')
  @ApiOperation({
    summary: 'Class policy (A)',
    description: 'Inherits the class-level policy and shares its 6 requests / 20s bucket with the other routes.',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  a() {
    return { ok: true, case: 'class-a' }
  }

  @Get('b')
  @ApiOperation({
    summary: 'Class policy (B)',
    description: 'Inherits the same shared class bucket (6 requests / 20s) as route a.',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  b() {
    return { ok: true, case: 'class-b' }
  }

  @Get('override')
  @ApiOperation({
    summary: 'Method overrides class',
    description: 'Method-level @RateLimit replaces the class policy with its own bucket (2 requests / 20s).',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @RateLimit({ limit: 2, window: '20s' })
  override() {
    return { ok: true, case: 'class-override' }
  }

  @Get('skip')
  @ApiOperation({
    summary: 'Skip beats the class policy',
    description: '@SkipRateLimit disables rate limiting on the guard layer even though the class declares a policy.',
  })
  @ApiResponse(429, { description: 'Rate limit exceeded.' })
  @SkipRateLimit()
  skip() {
    return { ok: true, case: 'class-skip' }
  }
}
