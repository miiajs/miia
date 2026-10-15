import type { Token } from '@miiajs/core'
import { createToken } from '@miiajs/core'
import type { DrizzleService } from './drizzle.service.js'

export type DrizzleDbToken<TDb = any> = Token<TDb>

// An empty name is the default connection, as in DrizzleModule.configure()
function memoByName<T>(create: (name: string | undefined) => Token<T>): (name?: string) => Token<T> {
  const cache = new Map<string, Token<T>>()
  return (name) => {
    const key = name || ''
    let token = cache.get(key)
    if (!token) {
      token = create(name || undefined)
      cache.set(key, token)
    }
    return token
  }
}

/** The `configure()` call that provides the connection `name`, for hints and errors. */
export function configureCall(name?: string): string {
  return name ? `DrizzleModule.configure(opts, { name: '${name}' })` : 'DrizzleModule.configure()'
}

const dbToken = memoByName((name) =>
  createToken<unknown>(`drizzleDb(${name ?? 'default'})`, { hint: configureCall(name) }),
)

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
  return dbToken(name) as DrizzleDbToken<TDb>
}

// ─── Internal token helpers (not exported from package index) ─────────────

export const getInternalServiceToken: (name?: string) => Token<DrizzleService> = memoByName((name) =>
  createToken<DrizzleService>(`DrizzleService(${name ?? 'default'})`),
)
