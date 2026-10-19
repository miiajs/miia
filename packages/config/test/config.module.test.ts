import { describe, expect, it } from 'bun:test'
import { Injectable, Miia, Module } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { z } from 'zod'
import { ConfigModule } from '../src/config.module.js'
import { ConfigService } from '../src/config.service.js'
import { CONFIG_SOURCE, CONFIG_VALUES } from '../src/tokens.js'

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

    it('takes a frozen snapshot of process.env at startup - a later change is not seen', async () => {
      const prevValue = process.env.MIIA_CONFIG_SNAPSHOT
      process.env.MIIA_CONFIG_SNAPSHOT = 'one'

      try {
        @Module({ imports: [ConfigModule.configure()] })
        class AppModule {}

        const app = await TestApp.create(AppModule).compile()
        process.env.MIIA_CONFIG_SNAPSHOT = 'two'
        expect(app.resolve(ConfigService).get('MIIA_CONFIG_SNAPSHOT')).toBe('one')
        expect(Object.isFrozen(app.resolve(CONFIG_VALUES))).toBe(true)
        expect(Object.isFrozen(process.env)).toBe(false)
        await app.close()
      } finally {
        if (prevValue === undefined) delete process.env.MIIA_CONFIG_SNAPSHOT
        else process.env.MIIA_CONFIG_SNAPSHOT = prevValue
      }
    })

    it('takes a snapshot of the supplied env - a later change to it is not seen, and it is not frozen', async () => {
      const env: Record<string, string | undefined> = { KEY: 'one' }

      @Module({ imports: [ConfigModule.configure({ env })] })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      env.KEY = 'two'
      env.ADDED = 'yes'
      const config = app.resolve(ConfigService)
      expect(config.get('KEY')).toBe('one')
      expect(config.get('ADDED')).toBeUndefined()
      expect(Object.isFrozen(env)).toBe(false)
      await app.close()
    })

    it('holds the env itself in a frozen CONFIG_SOURCE', async () => {
      const env = { KEY: 'one' }

      @Module({ imports: [ConfigModule.configure({ env })] })
      class EnvModule {}

      @Module({ imports: [ConfigModule.configure()] })
      class ProcessEnvModule {}

      const app = await TestApp.create(EnvModule).compile()
      const source = app.resolve(CONFIG_SOURCE)
      expect(source.env).toBe(env)
      expect(Object.isFrozen(source)).toBe(true)
      expect(Object.isFrozen(env)).toBe(false)
      await app.close()

      const processApp = await TestApp.create(ProcessEnvModule).compile()
      expect(processApp.resolve(CONFIG_SOURCE).env).toBe(process.env)
      await processApp.close()
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

  describe('frozen values from a schema', () => {
    async function compile<T extends Record<string, any>>(schema: z.ZodType<T>, env: Record<string, string> = {}) {
      @Module({ imports: [ConfigModule.configure({ schema, env })] })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      return { app, config: app.resolve<ConfigService<T>>(ConfigService) }
    }

    it('freezes an array from a transform - push throws TypeError', async () => {
      const { app, config } = await compile(z.object({ ORIGINS: z.string().transform((v) => v.split(',')) }), {
        ORIGINS: 'a.com,b.com',
      })
      const origins = config.get('ORIGINS')
      expect(Object.isFrozen(origins)).toBe(true)
      expect(() => origins.push('evil.com')).toThrow(TypeError)
      expect(config.get('ORIGINS')).toEqual(['a.com', 'b.com'])
      await app.close()
    })

    it('freezes a nested object from a transform', async () => {
      const { app, config } = await compile(
        z.object({ DB: z.string().transform((url) => ({ url, pool: { min: 1, max: 4 } })) }),
        { DB: 'postgres://localhost' },
      )
      const db = config.get('DB')
      expect(Object.isFrozen(db)).toBe(true)
      expect(Object.isFrozen(db.pool)).toBe(true)
      expect(() => {
        db.pool.max = 100
      }).toThrow(TypeError)
      await app.close()
    })

    it('copies a cyclic object from a transform once, keeping the cycle and shared parts', async () => {
      let original: Record<string, any> | undefined
      const { app, config } = await compile(
        z.object({
          GRAPH: z.string().transform((name) => {
            const shared = { name }
            const node: Record<string, any> = { shared, again: shared }
            node.self = node
            original = node
            return node
          }),
        }),
        { GRAPH: 'root' },
      )
      const graph = config.get('GRAPH')
      expect(graph).not.toBe(original)
      expect(graph.self).toBe(graph)
      expect(graph.again).toBe(graph.shared)
      expect(graph.shared.name).toBe('root')
      expect(Object.isFrozen(graph)).toBe(true)
      expect(Object.isFrozen(graph.shared)).toBe(true)
      expect(Object.isFrozen(original)).toBe(false)
      await app.close()
    })

    it('freezes a copy of a default, not the constant the schema returns', async () => {
      const defaults = ['localhost']
      const { app, config } = await compile(z.object({ HOSTS: z.array(z.string()).default(defaults) }))
      expect(config.get('HOSTS')).toEqual(['localhost'])
      expect(Object.isFrozen(config.get('HOSTS'))).toBe(true)
      expect(Object.isFrozen(defaults)).toBe(false)
      await app.close()
    })

    it('regression: returns a Map from a transform as is, not frozen', async () => {
      let original: Map<string, boolean> | undefined
      const { app, config } = await compile(
        z.object({
          FLAGS: z.string().transform((v) => {
            original = new Map(v.split(',').map((key) => [key, true]))
            return original
          }),
        }),
        { FLAGS: 'a,b' },
      )
      const flags = config.get('FLAGS')
      expect(flags).toBe(original as Map<string, boolean>)
      expect(Object.isFrozen(flags)).toBe(false)
      flags.set('c', true)
      expect(flags.get('c')).toBe(true)
      await app.close()
    })
  })

  describe('factory form', () => {
    it('regression: calls the options factory exactly once', async () => {
      let calls = 0

      @Module({
        imports: [
          ConfigModule.configure(() => {
            calls++
            return { schema: z.object({ PORT: z.string() }), env: { PORT: '8080' } }
          }),
        ],
      })
      class AppModule {}

      const app = await TestApp.create(AppModule).compile()
      expect(app.resolve(ConfigService).get('PORT')).toBe('8080')
      expect(calls).toBe(1)
      await app.close()
    })

    it('resolves dependencies from the DI container', async () => {
      @Injectable()
      class EnvProvider {
        readonly env = { PORT: '8080', HOST: '0.0.0.0' }
      }

      @Module({
        providers: [EnvProvider],
        imports: [
          ConfigModule.configure((resolve) => {
            const provider = resolve(EnvProvider)
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

  describe('exports and global', () => {
    it('exports ConfigService and the env source, and leaves global unset by default', () => {
      const configured = ConfigModule.configure()
      expect(configured.exports).toEqual([ConfigService, CONFIG_SOURCE])
      expect(configured.global).toBeUndefined()
    })

    it('passes { global: true } through', () => {
      expect(ConfigModule.configure({}, { global: true }).global).toBe(true)
    })
  })

  describe('without ConfigModule.configure()', () => {
    it('names ConfigModule.configure() when ConfigService is not provided', () => {
      expect(() => new Miia({ logger: false }).get(ConfigService)).toThrow(
        'ConfigService is provided by ConfigModule.configure()',
      )
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
