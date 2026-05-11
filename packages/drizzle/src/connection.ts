import { Logger } from '@miiajs/core'
import type { Dialect } from './types.js'

export interface ConnectionResult {
  client: any
  createDb: (schema: Record<string, any>) => any
}

class DrizzleLogger {
  constructor(private logger: Logger) {}
  logQuery(query: string, params: unknown[]): void {
    this.logger.debug(`${query} -- ${JSON.stringify(params)}`)
  }
}

export async function createConnection(
  dialect: Dialect,
  url: string,
  logger: Logger,
  casing?: 'snake_case' | 'camelCase',
  pool?: Record<string, unknown>,
): Promise<ConnectionResult> {
  const drizzleLogger = new DrizzleLogger(logger)

  switch (dialect) {
    case 'postgres': {
      const postgresModule = await import('postgres')
      const postgres = ('default' in postgresModule ? postgresModule.default : postgresModule) as any
      const client = postgres(url, pool)
      await client`SELECT 1`
      const { drizzle } = await import('drizzle-orm/postgres-js')
      return {
        client,
        createDb: (schema) => drizzle(client, { schema, logger: drizzleLogger, casing }),
      }
    }
    case 'mysql': {
      // @ts-expect-error - mysql2 is an optional peer dependency
      const mysql2 = await import('mysql2/promise')
      const mysqlPool = mysql2.createPool({ uri: url, ...pool })
      await mysqlPool.query('SELECT 1')
      const { drizzle } = await import('drizzle-orm/mysql2')
      return {
        client: mysqlPool,
        createDb: (schema) => drizzle(mysqlPool as any, { schema, mode: 'default', logger: drizzleLogger, casing }),
      }
    }
    case 'sqlite': {
      // @ts-expect-error - better-sqlite3 is an optional peer dependency
      const Database = (await import('better-sqlite3')).default
      const sqlite = new Database(url)
      sqlite.pragma('journal_mode')
      const { drizzle } = await import('drizzle-orm/better-sqlite3')
      return {
        client: sqlite,
        createDb: (schema) => drizzle(sqlite as any, { schema, logger: drizzleLogger, casing }),
      }
    }
    default:
      throw new Error(`[Miia/Drizzle] Unknown dialect: ${dialect as string}`)
  }
}

export async function closeConnection(dialect: Dialect, client: any): Promise<void> {
  switch (dialect) {
    case 'postgres':
      await client.end()
      break
    case 'mysql':
      await client.end()
      break
    case 'sqlite':
      client.close()
      break
  }
}
