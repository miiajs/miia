import type { Addon } from '../scaffold/addons.js'
import { biome } from './biome.js'
import { cors } from './cors.js'
import { drizzleAddon } from './drizzle.js'
import { jwtAuth } from './jwt-auth.js'
import { mongoose, papr } from './mongo.js'
import { rateLimit } from './rate-limit.js'
import { serveStatic } from './serve-static.js'
import { swagger } from './swagger.js'

export const registry: Addon[] = [
  jwtAuth,
  swagger,
  cors,
  serveStatic,
  rateLimit,
  biome,
  drizzleAddon('postgres'),
  drizzleAddon('mysql'),
  drizzleAddon('sqlite'),
  papr,
  mongoose,
]
