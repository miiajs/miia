import type { Token } from '@miiajs/core'
import { createToken } from '@miiajs/core'
import type { Db } from 'mongodb'
import type { ModelToken } from './define-model.js'
import type { PaprService } from './papr.service.js'

export type PaprDbToken = Token<Db>

// An empty name is the default connection, as in PaprModule.configure()
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
  return name ? `PaprModule.configure(opts, { name: '${name}' })` : 'PaprModule.configure()'
}

const dbToken = memoByName((name) => createToken<Db>(`paprDb(${name ?? 'default'})`, { hint: configureCall(name) }))

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
  return dbToken(name)
}

// ─── Internal token helpers (not exported from package index) ─────────────

export const getInternalServiceToken: (name?: string) => Token<PaprService> = memoByName((name) =>
  createToken<PaprService>(`PaprService(${name ?? 'default'})`),
)

export const getRegistryToken: (name?: string) => Token<Map<ModelToken<any, any>, ModelToken<any, any>>> = memoByName(
  (name) => createToken<Map<ModelToken<any, any>, ModelToken<any, any>>>(`PaprRegistry(${name ?? 'default'})`),
)
