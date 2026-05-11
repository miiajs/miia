import { createDecorator } from '@miiajs/core'
import { API_SECURITY } from '../constants.js'
import type { ApiSecurityMeta } from '../types.js'

export const ApiSecurity = createDecorator<[name: string, scopes?: string[]]>((context, name, scopes = []) => {
  const meta = context.metadata as Record<symbol, any>
  const map: Map<string, ApiSecurityMeta[]> = meta[API_SECURITY] ?? new Map()
  const key = context.kind === 'class' ? '*' : String(context.name)
  const existing = map.get(key) ?? []
  map.set(key, [...existing, { name, scopes }])
  meta[API_SECURITY] = map
})
