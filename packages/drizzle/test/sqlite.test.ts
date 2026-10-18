import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Miia } from '@miiajs/core'
import { sql } from 'drizzle-orm'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { DrizzleModule } from '../src/drizzle.module.js'
import { DrizzleService } from '../src/drizzle.service.js'
import { drizzleDb, getInternalServiceToken } from '../src/tokens.js'
import type { SqliteDriver } from '../src/types.js'

const notes = sqliteTable('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
})
const schema = { notes }

async function start(driver?: SqliteDriver) {
  const app = new Miia({ logger: false }).register(
    DrizzleModule.configure({ dialect: 'sqlite', connection: { url: ':memory:', driver }, schema }),
  )
  await app.init()
  const db = app.get(drizzleDb<BunSQLiteDatabase<typeof schema>>())
  const client = (app.get(getInternalServiceToken()) as unknown as { client: unknown }).client
  return { app, db, client }
}

function roundTrip(db: BunSQLiteDatabase<typeof schema>) {
  db.run(sql`create table notes (id integer primary key autoincrement, title text not null)`)
  db.insert(notes).values({ title: 'first' }).run()
  return db.select().from(notes).all()
}

describe('sqlite on Bun', () => {
  it('uses bun:sqlite by default', async () => {
    const { app, db, client } = await start()
    expect(client).toBeInstanceOf(Database)
    expect(roundTrip(db)).toEqual([{ id: 1, title: 'first' }])
    await app.destroy()
    expect(() => (client as Database).query('select 1').get()).toThrow()
  })

  it('takes an explicit bun:sqlite driver', async () => {
    const { app, db, client } = await start('bun:sqlite')
    expect(client).toBeInstanceOf(Database)
    expect(roundTrip(db)).toEqual([{ id: 1, title: 'first' }])
    await app.destroy()
  })

  it('rejects connection.driver for other dialects', () => {
    expect(
      () => new DrizzleService({ dialect: 'postgres', connection: { url: 'postgres://x', driver: 'bun:sqlite' } }),
    ).toThrow(TypeError)
    expect(
      () => new DrizzleService({ dialect: 'mysql', connection: { url: 'mysql://x', driver: 'better-sqlite3' } }),
    ).toThrow('[Miia/Drizzle] connection.driver is only for dialect "sqlite"')
  })
})
