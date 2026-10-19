import { describe, expect, it } from 'bun:test'
import { inject, Injectable, Module } from '@miiajs/core'
import type { ZodLike } from '@miiajs/core'
import { TestApp } from '@miiajs/testing'
import { z } from 'zod'
import { ConfigModule } from '../src/config.module.js'
import { defineConfig } from '../src/define-config.js'

const PaymentsSchema = z.object({
  STRIPE_KEY: z.string(),
  CURRENCY: z.string().default('usd'),
  METHODS: z
    .string()
    .default('card')
    .transform((v) => v.split(',')),
})

async function compileError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (err) {
    return err as Error
  }
  throw new Error('expected compile() to fail')
}

/** A schema that counts its safeParse() calls. */
function counted<T>(schema: ZodLike<T>): { schema: ZodLike<T>; calls: () => number } {
  let calls = 0
  return {
    schema: {
      safeParse(data) {
        calls++
        return schema.safeParse(data)
      },
    },
    calls: () => calls,
  }
}

describe('defineConfig()', () => {
  it('returns a frozen token named after the config, with its name and schema', () => {
    const paymentsConfig = defineConfig('payments', PaymentsSchema)

    expect(Object.isFrozen(paymentsConfig)).toBe(true)
    expect(paymentsConfig.name).toBe('Config(payments)')
    expect(paymentsConfig.hint).toBe("ConfigModule.register() with defineConfig('payments')")
    expect(paymentsConfig.configName).toBe('payments')
    expect(paymentsConfig.schema).toBe(PaymentsSchema)
  })

  it('returns a new token on every call', () => {
    expect(defineConfig('payments', PaymentsSchema)).not.toBe(defineConfig('payments', PaymentsSchema))
  })
})

describe('ConfigModule.register()', () => {
  it('provides the validated value with defaults applied, frozen', async () => {
    const paymentsConfig = defineConfig('payments', PaymentsSchema)

    @Injectable()
    class PaymentsService {
      config = inject(paymentsConfig)
    }

    @Module({ imports: [ConfigModule.register(paymentsConfig)], providers: [PaymentsService] })
    class PaymentsModule {}

    const app = await TestApp.create(
      ConfigModule.configure({ env: { STRIPE_KEY: 'sk_test', METHODS: 'card,sepa' } }, { global: true }),
      PaymentsModule,
    ).compile()
    const config = app.resolve(PaymentsService).config
    const methods: string[] = config.METHODS
    expect(config).toEqual({ STRIPE_KEY: 'sk_test', CURRENCY: 'usd', METHODS: ['card', 'sepa'] })
    expect(app.resolve(paymentsConfig)).toBe(config)
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(methods)).toBe(true)
    expect(() => methods.push('evil')).toThrow(TypeError)
    await app.close()
  })

  it('names the config in the validation error', async () => {
    const paymentsConfig = defineConfig('payments', PaymentsSchema)

    @Module({ imports: [ConfigModule.register(paymentsConfig)] })
    class PaymentsModule {}

    const err = await compileError(
      TestApp.create(ConfigModule.configure({ env: {} }, { global: true }), PaymentsModule).compile(),
    )
    expect(err.message).toBe(
      "[Miia] Config validation failed for 'payments':\n" +
        '  - STRIPE_KEY: Invalid input: expected string, received undefined',
    )
  })

  it('gives every module that registers the same config one instance, validated once', async () => {
    const { schema, calls } = counted(PaymentsSchema)
    const paymentsConfig = defineConfig('payments', schema)

    @Injectable()
    class Checkout {
      config = inject(paymentsConfig)
    }

    @Injectable()
    class Refunds {
      config = inject(paymentsConfig)
    }

    @Module({ imports: [ConfigModule.register(paymentsConfig)], providers: [Checkout] })
    class CheckoutModule {}

    @Module({ imports: [ConfigModule.register(paymentsConfig)], providers: [Refunds] })
    class RefundsModule {}

    const app = await TestApp.create(
      ConfigModule.configure({ env: { STRIPE_KEY: 'sk_test' } }, { global: true }),
      CheckoutModule,
      RefundsModule,
    ).compile()
    expect(app.resolve(Checkout).config).toBe(app.resolve(Refunds).config)
    expect(calls()).toBe(1)
    await app.close()
  })

  describe('env source', () => {
    const KEY = 'MIIA_FEATURE_CONFIG_SOURCE'
    const sourceConfig = () => defineConfig('source', z.object({ [KEY]: z.string() }))

    async function readWith(env: Record<string, string> | null): Promise<string> {
      const config = sourceConfig()

      @Injectable()
      class Reader {
        config = inject(config)
      }

      @Module({ imports: [ConfigModule.register(config)], providers: [Reader] })
      class FeatureModule {}

      const roots = env === null ? [] : [ConfigModule.configure({ env }, { global: true })]
      const app = await TestApp.create(...roots, FeatureModule).compile()
      const value = app.resolve(Reader).config[KEY]
      await app.close()
      return value
    }

    async function withProcessEnv<T>(value: string, fn: () => Promise<T>): Promise<T> {
      const prev = process.env[KEY]
      process.env[KEY] = value
      try {
        return await fn()
      } finally {
        if (prev === undefined) delete process.env[KEY]
        else process.env[KEY] = prev
      }
    }

    it('reads the env of the root ConfigModule.configure(), not process.env', async () => {
      const value = await withProcessEnv('from-process', () => readWith({ [KEY]: 'from-root' }))
      expect(value).toBe('from-root')
    })

    it('reads process.env without a root ConfigModule.configure()', async () => {
      const value = await withProcessEnv('from-process', () => readWith(null))
      expect(value).toBe('from-process')
    })
  })

  describe('a root config the registering module cannot see', () => {
    const report = (registers: string, configuredIn: string) =>
      '[Miia] 1 module boundary violation:\n\n' +
      `Config(payments) (ConfigModule.register(payments) in ${registers}) injects ConfigSource ` +
      `(ConfigModule in ${configuredIn}), which is not global:\n` +
      '  - make it global: ConfigModule.configure(options, { global: true })\n' +
      `  - or add ConfigModule to ${registers} \`imports\`\n\n` +
      'Docs: /docs/core-concepts/modules#boundaries'

    it('is a boundary violation, whatever the order of imports', async () => {
      const paymentsConfig = defineConfig('payments', PaymentsSchema)

      @Injectable()
      class PaymentsService {
        config = inject(paymentsConfig)
      }

      @Module({ imports: [ConfigModule.register(paymentsConfig)], providers: [PaymentsService] })
      class PaymentsModule {}

      // Configures the root config without making it global or exporting it
      @Module({ imports: [ConfigModule.configure({ env: { STRIPE_KEY: 'sk_test' } })] })
      class ConfigHolder {}

      @Module({ imports: [ConfigHolder, PaymentsModule] })
      class HolderFirst {}

      @Module({ imports: [PaymentsModule, ConfigHolder] })
      class FeatureFirst {}

      const holderFirst = await compileError(TestApp.create(HolderFirst).compile())
      const featureFirst = await compileError(TestApp.create(FeatureFirst).compile())
      expect(holderFirst.message).toBe(report('PaymentsModule', 'ConfigHolder'))
      expect(featureFirst.message).toBe(holderFirst.message)
    })

    it('is a violation from the module that does not import ConfigModule when two modules register it', async () => {
      const paymentsConfig = defineConfig('payments', PaymentsSchema)

      @Module({ imports: [ConfigModule, ConfigModule.register(paymentsConfig)] })
      class CheckoutModule {}

      @Module({ imports: [ConfigModule.register(paymentsConfig)] })
      class RefundsModule {}

      @Module({ imports: [ConfigModule.configure({ env: { STRIPE_KEY: 'sk_test' } })] })
      class ConfigHolder {}

      @Module({ imports: [ConfigHolder, CheckoutModule, RefundsModule] })
      class CheckoutFirst {}

      @Module({ imports: [ConfigHolder, RefundsModule, CheckoutModule] })
      class RefundsFirst {}

      const checkoutFirst = await compileError(TestApp.create(CheckoutFirst).compile())
      const refundsFirst = await compileError(TestApp.create(RefundsFirst).compile())
      expect(checkoutFirst.message).toBe(report('RefundsModule', 'ConfigHolder'))
      expect(refundsFirst.message).toBe(checkoutFirst.message)
    })
  })

  it('is replaced by TestApp.override() like any provider', async () => {
    const { schema, calls } = counted(PaymentsSchema)
    const paymentsConfig = defineConfig('payments', schema)

    @Injectable()
    class PaymentsService {
      config = inject(paymentsConfig)
    }

    @Module({ imports: [ConfigModule.register(paymentsConfig)], providers: [PaymentsService] })
    class PaymentsModule {}

    // No STRIPE_KEY in the env: the override replaces the factory, so nothing is validated
    const app = await TestApp.create(ConfigModule.configure({ env: {} }, { global: true }), PaymentsModule)
      .override(paymentsConfig, { STRIPE_KEY: 'sk_override' })
      .compile()
    expect(app.resolve(PaymentsService).config.STRIPE_KEY).toBe('sk_override')
    expect(calls()).toBe(0)
    await app.close()
  })
})
