import { describe, expect, it } from 'bun:test'
import { Injectable, Module } from '@miiajs/core'
import { TestApp } from '@miiajs/core/testing'
import { z } from 'zod'
import { ConfigModule } from '../src/config.module.js'
import { ConfigService } from '../src/config.service.js'

describe('ConfigModule', () => {
  describe('without schema', () => {
    it('exposes process.env via ConfigService when no env override is given', async () => {
      const prevValue = process.env.MIIA_CONFIG_TEST
      process.env.MIIA_CONFIG_TEST = 'from-process-env'

      try {
        @Module({ imports: [ConfigModule.configure()] })
        class AppModule {}

        const app = await TestApp.create(AppModule).compile()
        const config = app.resolve(ConfigService)
        expect(config.get('MIIA_CONFIG_TEST')).toBe('from-process-env')
        await app.close()
      } finally {
        if (prevValue === undefined) delete process.env.MIIA_CONFIG_TEST
        else process.env.MIIA_CONFIG_TEST = prevValue
      }
    })

    it('uses the supplied env object when provided', async () => {
      @Module({
        imports: [ConfigModule.configure({ env: { CUSTOM_KEY: 'custom-value' } })],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      const config = app.resolve(ConfigService)
      expect(config.get('CUSTOM_KEY')).toBe('custom-value')
      expect(config.get('NON_EXISTENT')).toBeUndefined()
      await app.close()
    })

    it('configure() defaults to empty options when called without arguments', async () => {
      @Module({ imports: [ConfigModule.configure()] })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      const config = app.resolve(ConfigService)
      expect(config).toBeInstanceOf(ConfigService)
      await app.close()
    })
  })

  describe('with schema', () => {
    const Schema = z.object({
      PORT: z.coerce.number().int().positive(),
      HOST: z.string().min(1),
      DEBUG: z.coerce.boolean().optional(),
    })

    it('parses, coerces, and exposes the validated values', async () => {
      @Module({
        imports: [
          ConfigModule.configure({
            schema: Schema,
            env: { PORT: '4000', HOST: 'example.com', DEBUG: 'true' },
          }),
        ],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      const config = app.resolve<ConfigService<z.infer<typeof Schema>>>(ConfigService)
      expect(config.get('PORT')).toBe(4000)
      expect(config.get('HOST')).toBe('example.com')
      expect(config.get('DEBUG')).toBe(true)
      await app.close()
    })

    it('throws a formatted validation error on bad input', async () => {
      @Module({
        imports: [
          ConfigModule.configure({
            schema: Schema,
            env: { PORT: 'not-a-number', HOST: '' },
          }),
        ],
      })
      class AppModule {}

      const promise = TestApp.create(AppModule).compile()
      await expect(promise).rejects.toThrow(/\[Miia\] Config validation failed:/)
      await expect(promise).rejects.toThrow(/PORT/)
      await expect(promise).rejects.toThrow(/HOST/)
    })

    it('reports nested zod paths in the error message', async () => {
      const Nested = z.object({
        nested: z.object({ value: z.string() }),
      })

      @Module({
        imports: [
          ConfigModule.configure({
            schema: Nested,
            env: { nested: { value: 123 } } as any,
          }),
        ],
      })
      class AppModule {}

      const promise = TestApp.create(AppModule).compile()
      await expect(promise).rejects.toThrow(/nested\.value/)
    })
  })

  describe('factory form', () => {
    it('resolves dependencies from the DI container', async () => {
      @Injectable({ token: 'EnvProvider' })
      class EnvProvider {
        readonly env = { PORT: '8080', HOST: '0.0.0.0' }
      }

      @Module({
        providers: [EnvProvider],
        imports: [
          ConfigModule.configure((resolve) => {
            const provider = resolve<EnvProvider>('EnvProvider')
            return { env: provider.env }
          }),
        ],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      const config = app.resolve(ConfigService)
      expect(config.get('PORT')).toBe('8080')
      expect(config.get('HOST')).toBe('0.0.0.0')
      await app.close()
    })
  })

  describe('getOrThrow integration', () => {
    it('throws a descriptive error from the DI-resolved service', async () => {
      @Module({
        imports: [ConfigModule.configure({ env: { ONLY_THIS: 'yes' } })],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      const config = app.resolve(ConfigService)
      expect(config.getOrThrow('ONLY_THIS')).toBe('yes')
      expect(() => config.getOrThrow('MISSING')).toThrow('[Miia] Config key "MISSING" not found')
      await app.close()
    })
  })
})
