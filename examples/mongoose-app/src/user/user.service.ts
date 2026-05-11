import { Injectable, inject } from '@miiajs/core'
import { mongooseConnection } from '@miiajs/mongoose'
import { User } from './user.model'

@Injectable()
export class UserService {
  private users = inject(User)
  private connection = inject(mongooseConnection())

  async findAll() {
    return this.users.find()
  }

  async findById(id: string) {
    return this.users.findById(id)
  }

  async create(data: { name: string; email: string }) {
    return this.users.create(data)
  }

  async update(id: string, data: Record<string, any>) {
    return this.users.findByIdAndUpdate(id, data, { returnDocument: 'after' })
  }

  async delete(id: string) {
    const result = await this.users.deleteOne({ _id: id })
    return result.deletedCount > 0
  }

  async stats() {
    const total = await this.users.countDocuments()
    const collections = (await this.connection.db?.listCollections().toArray()) ?? []
    return { total, collections: collections.map((c) => c.name) }
  }
}
