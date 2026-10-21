import { ConflictException, Injectable, inject } from '@miiajs/core'
import { DrizzleQueryError, eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from './user.table'

const UNIQUE_VIOLATION = '23505'

@Injectable()
export class UserService {
  private db = inject(db)

  async findAll() {
    return this.db.select().from(users)
  }

  async findById(id: number) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id))
    return user
  }

  async create(data: { name: string; email: string }) {
    try {
      const [user] = await this.db.insert(users).values(data).returning()
      return user
    } catch (err) {
      throw this.writeError(err, 'create')
    }
  }

  async update(id: number, data: Record<string, any>) {
    try {
      const [user] = await this.db.update(users).set(data).where(eq(users.id, id)).returning()
      return user
    } catch (err) {
      throw this.writeError(err, 'update')
    }
  }

  async delete(id: number) {
    const [deleted] = await this.db.delete(users).where(eq(users.id, id)).returning()
    return !!deleted
  }

  private writeError(err: unknown, action: 'create' | 'update'): unknown {
    if (!(err instanceof DrizzleQueryError)) return err
    const code = (err.cause as { code?: unknown } | undefined)?.code
    if (code === UNIQUE_VIOLATION) return new ConflictException('User with this email already exists')
    // The message of a DrizzleQueryError lists the query parameters
    return new Error(`Failed to ${action} user${typeof code === 'string' ? ` (code ${code})` : ''}`)
  }
}
