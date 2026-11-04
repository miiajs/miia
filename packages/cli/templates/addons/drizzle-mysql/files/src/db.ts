import { drizzleDb } from '@miiajs/drizzle'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import type * as schema from './db.schema.js'

// The one typed handle: inject(db) everywhere, do not call drizzleDb<...>() again
export const db = drizzleDb<MySql2Database<typeof schema>>()
