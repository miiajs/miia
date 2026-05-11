import { Injectable, inject } from '@miiajs/core'
import { paprDb } from '@miiajs/papr'
import { User } from './user.schema'
import { ObjectId } from 'mongodb'

@Injectable()
export class UserService {
  private users = inject(User)
  private db = inject(paprDb())

  async findAll() {
    return this.users.find({})
  }

  async findById(id: string) {
    return this.users.findOne({ _id: new ObjectId(id) })
  }

  async create(data: { name: string; email: string }) {
    return this.users.insertOne({
      ...data,
      role: 'user',
      createdAt: new Date(),
    })
  }

  async update(id: string, data: Record<string, any>) {
    const { ObjectId } = await import('mongodb')
    return this.users.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: data }, { returnDocument: 'after' })
  }

  async delete(id: string) {
    const { ObjectId } = await import('mongodb')
    const result = await this.users.deleteOne({ _id: new ObjectId(id) })
    return result.deletedCount > 0
  }

  async stats() {
    const total = await this.db.collection('users').countDocuments()
    return { total }
  }
}
