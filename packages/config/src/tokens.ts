import { createToken } from '@miiajs/core'

export const CONFIG_VALUES = createToken<Record<string, unknown>>('ConfigValues')
