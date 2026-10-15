import { createToken } from '@miiajs/core'
import type { RateLimitModuleOptions } from './guard.js'

export const RATE_LIMIT_OPTIONS = createToken<RateLimitModuleOptions>('RateLimitOptions')
