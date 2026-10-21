import { afterAll, beforeAll, describe, expect, it, type Mock, spyOn } from 'bun:test'
import { join } from 'node:path'
import { ConfigModule } from '@miiajs/config'
import { Logger } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { AppModule } from '../app.module'
import { envSchema } from '../env.schema'

// A Postgres database the test may migrate, e.g. postgres://postgres:postgres@localhost:5432/miia_test
const url = process.env.DATABASE_TEST_URL

const logged: string[] = []

describe.skipIf(!url)('UserController', () => {
  let app: TestApp
  let errors: Mock<Logger['error']>

  beforeAll(async () => {
    const client = postgres(url!, { max: 1, onnotice: () => {} })
    try {
      await migrate(drizzle(client), { migrationsFolder: join(import.meta.dirname, '../../drizzle') })
    } finally {
      await client.end()
    }
    errors = spyOn(Logger.prototype, 'error').mockImplementation((message, trace) => {
      logged.push(`${message}\n${trace ?? ''}`)
    })
    app = await TestApp.create(AppModule)
      .override(ConfigModule, ConfigModule.configure({ schema: envSchema, env: { DATABASE_URL: url } }))
      .compile()
  })

  afterAll(async () => {
    await app?.close()
    errors?.mockRestore()
  })

  it('answers 422 for an id that is not a positive 4-byte integer', async () => {
    for (const id of ['abc', '1.5', '2147483648', '0']) {
      for (const res of [
        await app.request('GET', `/users/${id}`),
        await app.request('PUT', `/users/${id}`, { body: { name: 'Bob' } }),
        await app.request('DELETE', `/users/${id}`),
      ]) {
        expect(res.status).toBe(422)
        expect((await res.json()).message).toBe('Params validation failed')
      }
    }
  })

  it('answers 404 for the largest id when no user has it', async () => {
    expect((await app.request('GET', '/users/2147483647')).status).toBe(404)
  })

  it('answers 409 for an email that is taken', async () => {
    const email = `taken-${Date.now()}@example.com`
    const created = await app.request('POST', '/users', { body: { name: 'Ann', email } })
    expect(created.status).toBe(201)
    try {
      const again = await app.request('POST', '/users', { body: { name: 'Bob', email } })
      expect(again.status).toBe(409)
      expect((await again.json()).message).toBe('User with this email already exists')
    } finally {
      await app.request('DELETE', `/users/${(await created.json()).id}`)
    }
  })

  it('keeps the query parameters out of the log when the insert fails', async () => {
    const email = `long-name-${Date.now()}@example.com`
    // users.name is varchar(255), the body schema has no upper bound
    const res = await app.request('POST', '/users', { body: { name: 'x'.repeat(256), email } })
    expect(res.status).toBe(500)
    expect(logged.join('\n')).not.toContain(email)
    expect(logged.join('\n')).toContain('Failed to create user (code 22001)')
  })

  it('answers 409 for an update to an email that is taken', async () => {
    const taken = `taken-${Date.now()}@example.com`
    const ids: number[] = []
    try {
      for (const email of [taken, `other-${Date.now()}@example.com`]) {
        const created = await app.request('POST', '/users', { body: { name: 'Ann', email } })
        expect(created.status).toBe(201)
        ids.push((await created.json()).id)
      }
      const res = await app.request('PUT', `/users/${ids[1]}`, { body: { email: taken } })
      expect(res.status).toBe(409)
      expect((await res.json()).message).toBe('User with this email already exists')
    } finally {
      for (const id of ids) await app.request('DELETE', `/users/${id}`)
    }
  })

  it('keeps the query parameters out of the log when the update fails', async () => {
    const email = `long-update-${Date.now()}@example.com`
    const created = await app.request('POST', '/users', { body: { name: 'Ann', email } })
    const { id } = await created.json()
    try {
      const res = await app.request('PUT', `/users/${id}`, { body: { name: 'y'.repeat(256) } })
      expect(res.status).toBe(500)
      expect(logged.join('\n')).not.toContain('y'.repeat(256))
      expect(logged.join('\n')).toContain('Failed to update user (code 22001)')
    } finally {
      await app.request('DELETE', `/users/${id}`)
    }
  })
})
