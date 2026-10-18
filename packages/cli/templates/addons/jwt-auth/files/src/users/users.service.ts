import { Injectable } from '@miiajs/core'

export interface User {
  id: number
  email: string
}

interface StoredUser extends User {
  passwordHash: string
}

// In-memory store: replace it with your database
@Injectable()
export class UsersService {
  private readonly users = new Map<number, StoredUser>()
  private nextId = 1

  async findById(id: number): Promise<User | undefined> {
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
    const user = { id: this.nextId++, ...data }
    this.users.set(user.id, user)
    return toUser(user)
  }
}

function toUser({ id, email }: StoredUser): User {
  return { id, email }
}
