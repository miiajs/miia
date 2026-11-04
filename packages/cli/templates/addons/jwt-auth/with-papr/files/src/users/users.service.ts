import { Injectable, inject } from '@miiajs/core'
import { ObjectId } from 'mongodb'
import { UsersModel } from './users.model.js'
import type { StoredUser, User } from './users.types.js'

@Injectable()
export class UsersService {
  private readonly users = inject(UsersModel)

  // Papr creates no indexes
  async onInit(): Promise<void> {
    await this.users.collection.createIndex({ email: 1 }, { unique: true })
  }

  async findById(id: string): Promise<User | undefined> {
    if (!ObjectId.isValid(id)) return undefined
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
    return toUser(await this.users.insertOne(data))
  }
}

function toUser(doc: { _id: ObjectId; email: string }): User {
  return { id: String(doc._id), email: doc.email }
}
