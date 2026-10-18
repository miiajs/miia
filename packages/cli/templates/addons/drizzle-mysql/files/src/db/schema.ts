import { mysqlTable, serial, timestamp, varchar } from 'drizzle-orm/mysql-core'

export const notes = mysqlTable('notes', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
