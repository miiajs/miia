import { createDecorator } from '@miiajs/core'
import { API_EXCLUDE } from '../constants.js'

export const ApiExclude = createDecorator((context) => {
  const meta = context.metadata as Record<symbol, any>
  const set: Set<string> = meta[API_EXCLUDE] ?? new Set()
  set.add(context.kind === 'class' ? '*' : String(context.name))
  meta[API_EXCLUDE] = set
})
