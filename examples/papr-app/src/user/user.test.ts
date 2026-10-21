import { describe, expect, it } from 'bun:test'
import { provider } from '@miiajs/core'
import { paprDb } from '@miiajs/papr'
import { TestApp } from '@miiajs/testing'
import { User } from './user.model'
import { UserModule } from './user.module'

// No database: the model is a stub that finds nothing, the real UserService builds the ObjectId
const users = {
  findOne: async () => null,
  findOneAndUpdate: async () => null,
  deleteOne: async () => ({ acknowledged: true, deletedCount: 0 }),
}

const createApp = () =>
  TestApp.create(UserModule)
    .override(User, users)
    .provide(provider(paprDb(), () => ({}) as never))
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

  it('answers 404 for a well-formed id that matches no user', async () => {
    const app = await createApp()
    const id = '0123456789abcdef01234567'
    try {
      for (const res of [
        await app.request('GET', `/users/${id}`),
        await app.request('PATCH', `/users/${id}`, { body: { name: 'Bob' } }),
        await app.request('DELETE', `/users/${id}`),
      ]) {
        expect(res.status).toBe(404)
      }
    } finally {
      await app.close()
    }
  })
})
