import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const __name__ = pgTable('__table__', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export type __Name__ = typeof __name__.$inferSelect
export type New__Name__ = typeof __name__.$inferInsert
