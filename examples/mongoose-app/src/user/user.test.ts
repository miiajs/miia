import { describe, expect, it } from 'bun:test'
import { provider } from '@miiajs/core'
import { mongooseConnection } from '@miiajs/mongoose'
import { TestApp } from '@miiajs/testing'
import mongoose from 'mongoose'
import { type IUser, User } from './user.model'
import { UserModule } from './user.module'
import { UserIdParamsSchema } from './schemas'

// No database: the real model on a connection that never opens, Mongoose casts the id before it needs one
const connection = mongoose.createConnection()
const users = connection.model<IUser>(User.modelName, User.schema)

const createApp = () =>
  TestApp.create(UserModule)
    .override(User, users)
    .provide(provider(mongooseConnection(), () => connection))
    .compile()

describe('UserController', () => {
  it('answers 422 for an id that is not an ObjectId', async () => {
    const app = await createApp()
    try {
      for (const res of [
        await app.request('GET', '/users/abc'),
        await app.request('PATCH', '/users/abc', { body: { name: 'Bob' } }),
        await app.request('DELETE', '/users/abc'),
      ]) {
        expect(res.status).toBe(422)
        expect((await res.json()).message).toBe('Params validation failed')
      }
    } finally {
      await app.close()
    }
  })

  it('accepts an ObjectId in hex', () => {
    const id = new mongoose.Types.ObjectId().toHexString()
    expect(UserIdParamsSchema.safeParse({ id }).success).toBe(true)
  })
})
