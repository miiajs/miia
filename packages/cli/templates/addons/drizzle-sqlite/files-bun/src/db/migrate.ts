import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

// drizzle-kit migrate needs better-sqlite3 under Node.js; on Bun the migrations run through bun:sqlite
const sqlite = new Database(process.env.DATABASE_URL ?? 'data.db', { create: true })
migrate(drizzle({ client: sqlite }), { migrationsFolder: './drizzle' })
sqlite.close()
