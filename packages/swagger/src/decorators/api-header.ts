import { createDecorator } from '@miiajs/core'
import { API_HEADERS } from '../constants.js'
import type { ApiHeaderMeta, ApiHeaderOptions } from '../types.js'

export const ApiHeader = createDecorator<[name: string, options?: ApiHeaderOptions]>((context, name, options) => {
  const entry: ApiHeaderMeta = { name, ...options }
  const meta = context.metadata as Record<symbol, any>
  const map: Map<string, ApiHeaderMeta[]> = meta[API_HEADERS] ?? new Map()
  const key = context.kind === 'class' ? '*' : String(context.name)
  const existing = map.get(key) ?? []
  map.set(key, [...existing, entry])
  meta[API_HEADERS] = map
})
