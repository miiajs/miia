import { describe, expect, it } from 'bun:test'
import { TestApp } from '@miiajs/testing'
import { __Name__Module } from './__file__.module.js'

const createApp = () => TestApp.create(__Name__Module).compile()

describe('__Name__Controller', () => {
  // One app for the whole flow: items live in the app instance
  it('creates, lists, reads, updates and deletes', async () => {
    const app = await createApp()
    try {
      const created = await app.request('POST', '/__file__', { body: { name: 'First' } })
      expect(created.status).toBe(201)
      const { id } = await created.json()

      const list = await app.request('GET', '/__file__')
      expect(await list.json()).toEqual([{ id, name: 'First' }])

      const found = await app.request('GET', `/__file__/${id}`)
      expect(found.status).toBe(200)
      expect(await found.json()).toEqual({ id, name: 'First' })

      const updated = await app.request('PATCH', `/__file__/${id}`, { body: { name: 'Renamed' } })
      expect(await updated.json()).toEqual({ id, name: 'Renamed' })

      const removed = await app.request('DELETE', `/__file__/${id}`)
      expect(removed.status).toBe(204)
      expect((await app.request('GET', `/__file__/${id}`)).status).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('answers 404 for a missing item and 422 for an invalid id or body', async () => {
    const app = await createApp()
    try {
      expect((await app.request('GET', `/__file__/${crypto.randomUUID()}`)).status).toBe(404)
      expect((await app.request('GET', '/__file__/999')).status).toBe(422)
      expect((await app.request('POST', '/__file__', { body: { name: '' } })).status).toBe(422)
    } finally {
      await app.close()
    }
  })
})
