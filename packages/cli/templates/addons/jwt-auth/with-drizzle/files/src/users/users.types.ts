import type { users } from './users.table.js'

export type StoredUser = typeof users.$inferSelect
export type User = Pick<StoredUser, 'id' | 'email'>
