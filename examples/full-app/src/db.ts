import { drizzleDb } from '@miiajs/drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from './db.schema.js'

export const db = drizzleDb<PostgresJsDatabase<typeof schema>>()
