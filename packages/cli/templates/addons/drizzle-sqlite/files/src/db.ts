import { drizzleDb } from '@miiajs/drizzle'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import type * as schema from './db.schema.js'

// The one typed handle: inject(db) everywhere, do not call drizzleDb<...>() again
export const db = drizzleDb<BunSQLiteDatabase<typeof schema>>()
