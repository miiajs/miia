import { injectOptional } from '@miiajs/core'
import { Injectable } from '@miiajs/core'

@Injectable({ token: 'ConfigService' })
export class ConfigService<T extends Record<string, any> = Record<string, string | undefined>> {
  private config: T

  constructor() {
    const config = injectOptional<T>('CONFIG_VALUES')
    this.config = config ?? ({} as T)
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.config[key]
  }

  getOrThrow<K extends keyof T>(key: K): T[K] {
    const value = this.config[key]
    if (value === undefined) {
      throw new Error(`[Miia] Config key "${String(key)}" not found`)
    }
    return value
  }
}
