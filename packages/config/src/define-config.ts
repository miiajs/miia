import type { Token, ZodLike } from '@miiajs/core'
import { createToken } from '@miiajs/core'

export type ConfigToken<T> = Token<Readonly<T>> & {
  readonly configName: string
  readonly schema: ZodLike<T>
}

// Not memoized: identity is the export site, a second defineConfig('payments', ...) is another token.
/** A typed token for a feature's own config, validated at startup; provide it with ConfigModule.register(). */
export function defineConfig<T>(name: string, schema: ZodLike<T>): ConfigToken<T> {
  const token = createToken<Readonly<T>>(`Config(${name})`, {
    hint: `ConfigModule.register() with defineConfig('${name}')`,
  })
  return Object.freeze({ ...token, configName: name, schema })
}
