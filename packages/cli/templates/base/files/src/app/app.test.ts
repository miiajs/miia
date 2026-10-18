import { describe, expect, it } from 'bun:test'
import { Module } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'

// Only what the controller needs: the test does not depend on the add-ons in AppModule
@Module({ controllers: [AppController], providers: [AppService] })
class TestModule {}

describe('AppController', () => {
  it('GET / greets', async () => {
    const app = await TestApp.create(TestModule).compile()
    try {
      const res = await app.request('GET', '/')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ message: 'Hello, Miia!' })
    } finally {
      await app.close()
    }
  })
})
