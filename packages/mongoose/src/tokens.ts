import type { Token } from '@miiajs/core'
import { createToken } from '@miiajs/core'
import type mongoose from 'mongoose'
import type { ModelToken } from './define-model.js'
import type { MongooseService } from './mongoose.service.js'

export type MongooseConnectionToken = Token<mongoose.Connection>

// An empty name is the default connection, as in MongooseModule.configure()
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
  return name ? `MongooseModule.configure(opts, { name: '${name}' })` : 'MongooseModule.configure()'
}

const connectionToken = memoByName((name) =>
  createToken<mongoose.Connection>(`mongooseConnection(${name ?? 'default'})`, { hint: configureCall(name) }),
)

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
  return connectionToken(name)
}

// ─── Internal token helpers (not exported from package index) ─────────────

export const getInternalServiceToken: (name?: string) => Token<MongooseService> = memoByName((name) =>
  createToken<MongooseService>(`MongooseService(${name ?? 'default'})`),
)

export const getRegistryToken: (name?: string) => Token<Map<ModelToken<any>, ModelToken<any>>> = memoByName((name) =>
  createToken<Map<ModelToken<any>, ModelToken<any>>>(`MongooseRegistry(${name ?? 'default'})`),
)
