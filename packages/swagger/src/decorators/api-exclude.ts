import { createDecorator } from '@miiajs/core'
import { API_EXCLUDE } from '../constants.js'

export const ApiExclude = createDecorator((context) => {
  const meta = context.metadata as Record<symbol, any>
  // A subclass reads its parent's set through the metadata prototype: copy it before the first write
  const set: Set<string> = Object.hasOwn(meta, API_EXCLUDE) ? meta[API_EXCLUDE] : new Set(meta[API_EXCLUDE])
  set.add(context.kind === 'class' ? '*' : String(context.name))
  meta[API_EXCLUDE] = set
})
