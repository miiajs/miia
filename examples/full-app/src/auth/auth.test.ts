import { describe, expect, it, spyOn } from 'bun:test'
import { ConfigModule } from '@miiajs/config'
import { Logger, Module, provider } from '@miiajs/core'
import { JwtModule } from '@miiajs/jwt'
import { TestApp } from '@miiajs/testing'
import { DrizzleQueryError } from 'drizzle-orm'
import { db } from '../db.js'
import { envSchema } from '../env.schema.js'
import type { NewUser } from '../users/user.table.js'
import { AuthModule } from './auth.module.js'

@Module({
  imports: [
    ConfigModule.configure(
      {
        schema: envSchema,
        // production skips the admin seed
        env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', JWT_SECRET: 'test', DATABASE_URL: 'unused' },
      },
      { global: true },
    ),
    JwtModule.configure({ secret: 'test-secret' }, { global: true }),
    AuthModule,
  ],
})
class TestModule {}

/** No user is found by email and every insert fails the way Postgres fails it, as Drizzle reports it. */
function failingDb(code: string) {
  const inserted: NewUser[] = []
  const query = { from: () => query, where: () => query, limit: async () => [] }
  const fake = {
    select: () => query,
    insert: () => ({
      values: (values: NewUser) => ({
        returning: async () => {
          inserted.push(values)
          const cause = Object.assign(new Error('insert into "users" failed'), { code })
          throw new DrizzleQueryError('insert into "users" ...', [values.email, values.passwordHash], cause)
        },
      }),
    }),
  }
  return { fake, inserted }
}

async function register(code: string) {
  const { fake, inserted } = failingDb(code)
  const logged: string[] = []
  const errors = spyOn(Logger.prototype, 'error').mockImplementation((message, trace) => {
    logged.push(`${message}\n${trace ?? ''}`)
  })
  try {
    const app = await TestApp.create(TestModule)
      .provide(provider(db, () => fake as never))
      .compile()
    try {
      const res = await app.request('POST', '/auth/register', {
        body: { email: 'ann@example.com', password: 'secret123' },
      })
      return { res, logged, passwordHash: inserted[0]?.passwordHash }
    } finally {
      await app.close()
    }
  } finally {
    errors.mockRestore()
  }
}

describe('POST /auth/register', () => {
  it('answers 409 when a concurrent registration took the email after the check', async () => {
    const { res } = await register('23505')
    expect(res.status).toBe(409)
    expect((await res.json()).message).toBe('User with this email already exists')
  })

  it('keeps the password hash out of the log when the insert fails', async () => {
    const { res, logged, passwordHash } = await register('23502')
    expect(res.status).toBe(500)
    expect(passwordHash).toStartWith('$argon2')
    expect(logged.join('\n')).not.toContain(passwordHash!)
    expect(logged.join('\n')).toContain('Failed to create user (code 23502)')
  })
})
