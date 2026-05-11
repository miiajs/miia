import { describe, expect, it } from 'bun:test'
import { Controller, Injectable, Module } from '../src/decorators/index.js'
import { getMeta, INJECTABLE, PREFIX, MODULE } from '../src/decorators/index.js'
import type { InjectableMeta } from '../src/decorators/index.js'
import type { ModuleOptions } from '../src/types.js'

describe('Decorators', () => {
  describe('@Injectable', () => {
    it('should store injectable metadata with default scope', () => {
      @Injectable()
      class TestService {
        value = 'test'
      }

      const meta = getMeta<InjectableMeta>(TestService, INJECTABLE)
      expect(meta).toBeDefined()
      expect(meta!.scope).toBe('singleton')
      expect(meta!.token).toBeUndefined()
    })

    it('should store custom scope in metadata', () => {
      @Injectable({ scope: 'transient' })
      class TransientService {}

      const meta = getMeta<InjectableMeta>(TransientService, INJECTABLE)
      expect(meta!.scope).toBe('transient')
    })

    it('should store string token in metadata', () => {
      @Injectable({ token: 'MY_SERVICE' })
      class TokenService {
        name = 'tokenized'
      }

      const meta = getMeta<InjectableMeta>(TokenService, INJECTABLE)
      expect(meta!.token).toBe('MY_SERVICE')
      expect(meta!.scope).toBe('singleton')
    })

    it('should not register in any container as side effect', () => {
      @Injectable()
      class PureMetadataService {}

      const meta = getMeta<InjectableMeta>(PureMetadataService, INJECTABLE)
      expect(meta).toBeDefined()
    })
  })

  describe('@Controller', () => {
    it('should store prefix metadata', () => {
      @Controller('/api/users')
      class UserController {}

      expect(getMeta<string>(UserController, PREFIX)).toBe('/api/users')
    })

    it('should default to empty prefix', () => {
      @Controller()
      class RootController {}

      expect(getMeta<string>(RootController, PREFIX)).toBe('')
    })

    it('should not register in any container as side effect', () => {
      @Controller('/test')
      class TestController {}

      expect(getMeta<string>(TestController, PREFIX)).toBe('/test')
    })
  })

  describe('@Module', () => {
    it('should store module metadata', () => {
      @Module({
        controllers: [],
        providers: [],
        prefix: '/api',
      })
      class AppModule {}

      const meta = getMeta<ModuleOptions>(AppModule, MODULE)
      expect(meta).toBeDefined()
      expect(meta!.prefix).toBe('/api')
      expect(meta!.controllers).toEqual([])
      expect(meta!.providers).toEqual([])
    })

    it('should store imports', () => {
      @Module({})
      class SubModule {}

      @Module({
        imports: [SubModule],
      })
      class MainModule {}

      const meta = getMeta<ModuleOptions>(MainModule, MODULE)
      expect(meta!.imports).toEqual([SubModule])
    })
  })
})
