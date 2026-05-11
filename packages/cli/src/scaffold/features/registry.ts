import type { Feature, FeatureId } from '../types.js'
import { configFeature } from './config.js'
import { jwtAuthFeature } from './jwt-auth.js'
import { swaggerFeature } from './swagger.js'
import { drizzlePostgresFeature } from './drizzle-postgres.js'
import { drizzleMysqlFeature } from './drizzle-mysql.js'
import { drizzleSqliteFeature } from './drizzle-sqlite.js'
import { paprFeature } from './papr.js'
import { mongooseFeature } from './mongoose.js'
import { corsFeature } from './cors.js'
import { serveStaticFeature } from './serve-static.js'
import { logger } from '../../utils/logger.js'

const allFeatures: Feature[] = [
  configFeature,
  jwtAuthFeature,
  swaggerFeature,
  drizzlePostgresFeature,
  drizzleMysqlFeature,
  drizzleSqliteFeature,
  paprFeature,
  mongooseFeature,
  corsFeature,
  serveStaticFeature,
]

const byId = new Map<FeatureId, Feature>()
for (const f of allFeatures) {
  byId.set(f.id, f)
}

export function getFeature(id: FeatureId): Feature | undefined {
  return byId.get(id)
}

export function getAllFeatures(): Feature[] {
  return allFeatures
}

/**
 * Resolve `requires` dependencies: auto-select required features.
 * Also validates `conflicts` - returns error message or null.
 */
export function resolveFeatures(selectedIds: FeatureId[]): { features: Feature[]; error?: string } {
  const resolved = new Set(selectedIds)

  // Auto-resolve requires
  let changed = true
  while (changed) {
    changed = false
    for (const id of [...resolved]) {
      const feature = byId.get(id)
      if (!feature?.requires) continue
      for (const req of feature.requires) {
        if (!resolved.has(req)) {
          resolved.add(req)
          changed = true
          logger.info(`  Auto-selected: ${byId.get(req)?.label ?? req} (required by ${feature.label})`)
        }
      }
    }
  }

  // Check conflicts
  for (const id of resolved) {
    const feature = byId.get(id)
    if (!feature?.conflicts) continue
    for (const conflictId of feature.conflicts) {
      if (resolved.has(conflictId)) {
        const conflicting = byId.get(conflictId)
        return {
          features: [],
          error: `${feature.label} conflicts with ${conflicting?.label ?? conflictId}. Pick one.`,
        }
      }
    }
  }

  // Build ordered list (preserve allFeatures order for deterministic output)
  const features = allFeatures.filter((f) => resolved.has(f.id))
  return { features }
}
