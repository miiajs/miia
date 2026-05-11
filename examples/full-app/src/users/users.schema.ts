import { pgEnum, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'
import { getTableColumns } from 'drizzle-orm'

export const userRoleEnum = pgEnum('user_role', ['admin', 'user', 'guest'])

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull().default(''),
  role: userRoleEnum('role').notNull().default('user'),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  avatarUrl: varchar('avatar_url', { length: 512 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

const { passwordHash: _, ...publicUserColumns } = getTableColumns(users)
export { publicUserColumns }
