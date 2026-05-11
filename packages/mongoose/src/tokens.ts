import type mongoose from 'mongoose'

export type MongooseConnectionToken = new () => mongoose.Connection

const cache = new Map<string, MongooseConnectionToken>()

/**
 * Returns a typed DI token for the raw `mongoose.Connection` of a MongooseModule connection.
 *
 * - `mongooseConnection()` - default connection.
 * - `mongooseConnection('analytics')` - named connection.
 *
 * Memoized by name: the same name always returns the same token,
 * so DI identity is stable across modules.
 */
export function mongooseConnection(name?: string): MongooseConnectionToken {
  const key = name ?? ''
  let cls = cache.get(key)
  if (!cls) {
    cls = class {
      static readonly __name = `mongooseConnection(${name ?? 'default'})`
    } as unknown as MongooseConnectionToken
    cache.set(key, cls)
  }
  return cls
}

// ─── Internal token helpers (not exported from package index) ─────────────

export function getInternalServiceToken(name?: string): string {
  return name ? `__MONGOOSE_SERVICE_${name}` : '__MONGOOSE_SERVICE'
}

export function getRegistryToken(name?: string): string {
  return name ? `__MONGOOSE_REGISTRY_${name}` : '__MONGOOSE_REGISTRY'
}
