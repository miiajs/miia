import { createToken } from '@miiajs/core'
import type { JwtOptions } from './jwt.types.js'

export const JWT_OPTIONS = createToken<JwtOptions>('JwtOptions', { hint: 'JwtModule.configure()' })
