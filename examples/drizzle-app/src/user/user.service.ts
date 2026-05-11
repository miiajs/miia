import { Injectable, inject } from '@miiajs/core'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from './user.schema'

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
    const [user] = await this.db.insert(users).values(data).returning()
    return user
  }

  async update(id: number, data: Record<string, any>) {
    const [user] = await this.db.update(users).set(data).where(eq(users.id, id)).returning()
    return user
  }

  async delete(id: number) {
    const [deleted] = await this.db.delete(users).where(eq(users.id, id)).returning()
    return !!deleted
  }
}
