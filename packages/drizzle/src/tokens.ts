export type DrizzleDbToken<TDb = any> = new () => TDb

const cache = new Map<string, DrizzleDbToken<unknown>>()

/**
 * Returns a typed DI token for the Drizzle database of a DrizzleModule connection.
 *
 * - `drizzleDb()` - default connection.
 * - `drizzleDb('analytics')` - named connection.
 *
 * The generic parameter is the concrete Drizzle database type for autocomplete:
 *
 *   export const db = drizzleDb<PostgresJsDatabase<typeof schema>>()
 *   export const analytics = drizzleDb<PostgresJsDatabase<typeof analyticsSchema>>('analytics')
 *
 * Memoization is by `name` only. The generic is compile-time - the runtime token
 * returned for a given name is identical across different `TDb` instantiations.
 * As a consequence, `drizzleDb<X>()` in one file and `drizzleDb<Y>()` in another
 * resolve to the same DI token but project different TypeScript types at each
 * call site. Keep a single `db.ts` per connection as the source of truth.
 */
export function drizzleDb<TDb = any>(name?: string): DrizzleDbToken<TDb> {
  const key = name ?? ''
  let cls = cache.get(key)
  if (!cls) {
    cls = class {
      static readonly __name = `drizzleDb(${name ?? 'default'})`
    } as unknown as DrizzleDbToken<unknown>
    cache.set(key, cls)
  }
  return cls as DrizzleDbToken<TDb>
}

// ─── Internal token helpers (not exported from package index) ─────────────

export function getInternalServiceToken(name?: string): string {
  return name ? `__DRIZZLE_SERVICE_${name}` : '__DRIZZLE_SERVICE'
}
