import { createDecorator } from '@miiajs/core'
import { API_HEADERS } from '../constants.js'
import type { ApiHeaderMeta, ApiHeaderOptions } from '../types.js'

export const ApiHeader = createDecorator<[name: string, options?: ApiHeaderOptions]>((context, name, options) => {
  const entry: ApiHeaderMeta = { name, ...options }
  const meta = context.metadata as Record<symbol, any>
  // A subclass reads its parent's map through the metadata prototype: copy it before the first write
  const map: Map<string, ApiHeaderMeta[]> = Object.hasOwn(meta, API_HEADERS)
    ? meta[API_HEADERS]
    : new Map(meta[API_HEADERS])
  const key = context.kind === 'class' ? '*' : String(context.name)
  const existing = map.get(key) ?? []
  map.set(key, [...existing, entry])
  meta[API_HEADERS] = map
})
