import { drizzleDb } from '@miiajs/drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from './db.schema.js'

// The one typed handle: inject(db) everywhere, do not call drizzleDb<...>() again
export const db = drizzleDb<PostgresJsDatabase<typeof schema>>()
