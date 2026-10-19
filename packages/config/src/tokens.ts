import { createToken } from '@miiajs/core'
import type { ConfigModuleOptions } from './config.module.js'

export interface ConfigSource {
  readonly env: Record<string, string | undefined>
}

export const CONFIG_OPTIONS = createToken<ConfigModuleOptions>('ConfigOptions')
export const CONFIG_SOURCE = createToken<ConfigSource>('ConfigSource', { hint: 'ConfigModule.configure()' })
export const CONFIG_VALUES = createToken<Record<string, unknown>>('ConfigValues')
