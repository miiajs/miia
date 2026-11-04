import { Injectable, inject } from '@miiajs/core'
import { isValidObjectId, type Types } from 'mongoose'
import { UsersModel } from './users.model.js'
import type { StoredUser, User } from './users.types.js'

@Injectable()
export class UsersService {
  private readonly users = inject(UsersModel)

  async findById(id: string): Promise<User | undefined> {
    if (!isValidObjectId(id)) return undefined
    const user = await this.users.findById(id)
    return user ? toUser(user) : undefined
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const user = await this.users.findOne({ email })
    return user ? toUser(user) : undefined
  }

  async findByEmailForAuth(email: string): Promise<StoredUser | undefined> {
    const user = await this.users.findOne({ email })
    return user ? { ...toUser(user), passwordHash: user.passwordHash } : undefined
  }

  async create(data: { email: string; passwordHash: string }): Promise<User> {
    return toUser(await this.users.create(data))
  }
}

function toUser(doc: { _id: Types.ObjectId; email: string }): User {
  return { id: String(doc._id), email: doc.email }
}
