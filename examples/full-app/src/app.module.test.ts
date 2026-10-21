import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { ConfigModule } from '@miiajs/config'
import { TestApp } from '@miiajs/testing'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { AppModule } from './app.module.js'
import { envSchema } from './env.schema.js'

// A Postgres database the test may migrate, e.g. postgres://postgres:postgres@localhost:5432/miia_test
const url = process.env.DATABASE_TEST_URL

describe.skipIf(!url)('AppModule on Postgres', () => {
  const email = `ids-${Date.now()}@example.com`
  let client: postgres.Sql
  let app: TestApp
  let token: string

  const request = (method: string, path: string) =>
    app.request(method, path, { headers: { authorization: `Bearer ${token}` } })

  beforeAll(async () => {
    client = postgres(url!, { max: 1, onnotice: () => {} })
    await migrate(drizzle(client), { migrationsFolder: join(import.meta.dirname, '../drizzle') })
    const env = {
      // production skips the admin seed
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '0',
      JWT_SECRET: 'test-secret',
      DATABASE_URL: url,
    }
    app = await TestApp.create(AppModule)
      .override(ConfigModule, ConfigModule.configure({ schema: envSchema, env }))
      .compile()
    const registered = await app.request('POST', '/auth/register', { body: { email, password: 'secret123' } })
    token = (await registered.json()).accessToken
  })

  afterAll(async () => {
    await app?.close()
    if (!client) return
    await client`DELETE FROM users WHERE email = ${email}`
    await client.end()
  })

  it('answers 422 for an id past the 4-byte integer range', async () => {
    for (const path of ['/users/99999999999', '/posts/99999999999']) {
      const res = await request('GET', path)
      expect(res.status).toBe(422)
      expect((await res.json()).message).toBe('Params validation failed')
    }
    const res = await request('GET', '/posts?authorId=99999999999')
    expect(res.status).toBe(422)
    expect((await res.json()).message).toBe('Query validation failed')
  })

  it('answers 404 for the largest id when nothing has it', async () => {
    expect((await request('GET', '/users/2147483647')).status).toBe(404)
    expect((await request('GET', '/posts/2147483647')).status).toBe(404)
  })
})
