import { describe, expect, it, spyOn } from 'bun:test'
import { ConfigModule } from '@miiajs/config'
import { Logger, Module, provider } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { db } from '../db.js'
import { envSchema } from '../env.schema.js'
import type { NewUser } from './user.table.js'
import { usersConfig } from './users.config.js'
import { UsersService } from './users.service.js'

const env = {
  HOST: '127.0.0.1',
  PORT: '0',
  JWT_SECRET: 'test',
  DATABASE_URL: 'unused',
  SEED_ADMIN_EMAIL: 'seed@example.com',
  SEED_ADMIN_PASSWORD: 'seed-password-123',
}

@Module({
  imports: [ConfigModule.configure({ schema: envSchema, env }, { global: true }), ConfigModule.register(usersConfig)],
  providers: [UsersService],
})
class TestModule {}

/** No user is found by email, and an insert returns the new row. */
function emptyDb() {
  const query = { from: () => query, where: () => query, limit: async () => [] }
  return {
    select: () => query,
    insert: () => ({
      values: (values: NewUser) => ({ returning: async () => [{ id: 1, email: values.email }] }),
    }),
  }
}

describe('UsersService.onReady', () => {
  it('logs the seeded admin without the password', async () => {
    const logged: string[] = []
    const logs = spyOn(Logger.prototype, 'log').mockImplementation((message) => {
      logged.push(message)
    })
    try {
      const app = await TestApp.create(TestModule)
        .provide(provider(db, () => emptyDb() as never))
        .compile()
      await app.close()
    } finally {
      logs.mockRestore()
    }

    const seeded = logged.find((line) => line.startsWith('Seeded admin user'))
    expect(seeded).toContain(env.SEED_ADMIN_EMAIL)
    expect(seeded).not.toContain(env.SEED_ADMIN_PASSWORD)
  })
})
