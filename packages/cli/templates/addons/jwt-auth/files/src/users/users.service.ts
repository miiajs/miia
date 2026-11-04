import { Injectable } from '@miiajs/core'
import type { StoredUser, User } from './users.types.js'

// In-memory store: replace it with your database
@Injectable()
export class UsersService {
  private readonly users = new Map<string, StoredUser>()

  async findById(id: string): Promise<User | undefined> {
    const user = this.users.get(id)
    return user && toUser(user)
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const user = await this.findByEmailForAuth(email)
    return user && toUser(user)
  }

  async findByEmailForAuth(email: string): Promise<StoredUser | undefined> {
    for (const user of this.users.values()) {
      if (user.email === email) return user
    }
    return undefined
  }

  async create(data: { email: string; passwordHash: string }): Promise<User> {
    const user = { id: crypto.randomUUID(), ...data }
    this.users.set(user.id, user)
    return toUser(user)
  }
}

function toUser({ id, email }: StoredUser): User {
  return { id, email }
}
