import { drizzleDb } from '@miiajs/drizzle'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from './db.schema.js'

// The one typed handle: inject(db) everywhere, do not call drizzleDb<...>() again
export const db = drizzleDb<BetterSQLite3Database<typeof schema>>()
