import { describe, expect, it } from 'bun:test'
import { JwtModule } from '@miiajs/jwt'
import { TestApp } from '@miiajs/testing'
import { UsersService } from '../users/users.service.js'
import type { StoredUser, User } from '../users/users.types.js'
import { AuthModule } from './auth.module.js'

// UsersService over a Map: this test needs no database
function fakeUsers() {
  const users = new Map<string, StoredUser>()
  const toUser = ({ id, email }: StoredUser): User => ({ id, email })
  const findByEmailForAuth = async (email: string) => [...users.values()].find((user) => user.email === email)
  return {
    findByEmailForAuth,
    findById: async (id: string) => {
      const user = users.get(id)
      return user && toUser(user)
    },
    findByEmail: async (email: string) => {
      const user = await findByEmailForAuth(email)
      return user && toUser(user)
    },
    create: async (data: { email: string; passwordHash: string }) => {
      const now = new Date()
      const user = { id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now }
      users.set(user.id, user)
      return toUser(user)
    },
  }
}

const createApp = () =>
  TestApp.create(JwtModule.configure({ secret: 'test-secret-that-is-at-least-32-chars' }, { global: true }), AuthModule)
    .override(UsersService, fakeUsers())
    .compile()

describe('auth', () => {
  // One app for the whole flow: the fake keeps users in the app instance
  it('registers, logs in and reads the current user', async () => {
    const app = await createApp()
    try {
      const credentials = { email: 'ada@example.com', password: 'correct-horse' }

      const registered = await app.request('POST', '/auth/register', { body: credentials })
      expect(registered.status).toBe(201)
      expect(typeof (await registered.json()).accessToken).toBe('string')

      const again = await app.request('POST', '/auth/register', { body: credentials })
      expect(again.status).toBe(409)

      const login = await app.request('POST', '/auth/login', { body: credentials })
      expect(login.status).toBe(200)
      const { accessToken } = await login.json()

      const wrong = await app.request('POST', '/auth/login', { body: { ...credentials, password: 'wrong-password' } })
      expect(wrong.status).toBe(401)

      const me = await app.request('GET', '/auth/me', { headers: { authorization: `Bearer ${accessToken}` } })
      expect(me.status).toBe(200)
      expect((await me.json()).email).toBe(credentials.email)
    } finally {
      await app.close()
    }
  })

  it('rejects /auth/me without a token', async () => {
    const app = await createApp()
    try {
      const res = await app.request('GET', '/auth/me')
      expect(res.status).toBe(401)
    } finally {
      await app.close()
    }
  })
})
