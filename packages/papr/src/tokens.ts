import type { Db } from 'mongodb'

export type PaprDbToken = new () => Db

const cache = new Map<string, PaprDbToken>()

/**
 * Returns a typed DI token for the raw mongodb `Db` of a PaprModule connection.
 *
 * - `paprDb()` - default connection.
 * - `paprDb('analytics')` - named connection.
 *
 * Memoized by name: the same name always returns the same token,
 * so DI identity is stable across modules.
 */
export function paprDb(name?: string): PaprDbToken {
  const key = name ?? ''
  let cls = cache.get(key)
  if (!cls) {
    cls = class {
      static readonly __name = `paprDb(${name ?? 'default'})`
    } as unknown as PaprDbToken
    cache.set(key, cls)
  }
  return cls
}

// ─── Internal token helpers (not exported from package index) ─────────────

export function getInternalServiceToken(name?: string): string {
  return name ? `__PAPR_SERVICE_${name}` : '__PAPR_SERVICE'
}

export function getRegistryToken(name?: string): string {
  return name ? `__PAPR_REGISTRY_${name}` : '__PAPR_REGISTRY'
}
