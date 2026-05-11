export type Dialect = 'postgres' | 'mysql' | 'sqlite'

export interface DrizzleModuleOptions {
  dialect: Dialect
  connection: {
    url: string
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
