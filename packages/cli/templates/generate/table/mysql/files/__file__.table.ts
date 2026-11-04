import { mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core'

export const __name__ = mysqlTable('__table__', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
})

export type __Name__ = typeof __name__.$inferSelect
export type New__Name__ = typeof __name__.$inferInsert
