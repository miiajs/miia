export type Dialect = 'postgres' | 'mysql' | 'sqlite'

export type SqliteDriver = 'bun:sqlite' | 'better-sqlite3'

export interface DrizzleModuleOptions {
  dialect: Dialect
  connection: {
    url: string
    /** sqlite only. Default: 'bun:sqlite' on Bun, 'better-sqlite3' elsewhere. */
    driver?: SqliteDriver
    pool?: Record<string, unknown>
    retry?: {
      attempts?: number
      delay?: number
    }
  }
  schema?: Record<string, unknown>
  casing?: 'snake_case' | 'camelCase'
}

export type { DrizzleDbToken } from './tokens.js'
