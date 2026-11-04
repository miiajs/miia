import { Injectable, inject } from '@miiajs/core'
import { eq } from 'drizzle-orm'
import { db } from '../db.js'
import { users } from './users.table.js'
import type { StoredUser, User } from './users.types.js'

const publicColumns = { id: users.id, email: users.email }

@Injectable()
export class UsersService {
  private readonly db = inject(db)

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.db.select(publicColumns).from(users).where(eq(users.id, id)).limit(1)
    return user
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db.select(publicColumns).from(users).where(eq(users.email, email)).limit(1)
    return user
  }

  async findByEmailForAuth(email: string): Promise<StoredUser | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1)
    return user
  }

  // Insert, then select: MySQL has no RETURNING
  async create(data: { email: string; passwordHash: string }): Promise<User> {
    await this.db.insert(users).values(data)
    const [user] = await this.db.select(publicColumns).from(users).where(eq(users.email, data.email)).limit(1)
    return user as User
  }
}
