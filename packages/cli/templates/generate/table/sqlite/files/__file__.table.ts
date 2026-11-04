import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const __name__ = sqliteTable('__table__', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
})

export type __Name__ = typeof __name__.$inferSelect
export type New__Name__ = typeof __name__.$inferInsert
