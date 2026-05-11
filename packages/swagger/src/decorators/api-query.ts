import { addToMapMeta } from '@miiajs/core'
import { API_QUERIES } from '../constants.js'
import type { ApiQueryMeta, ApiQueryOptions } from '../types.js'

export function ApiQuery(name: string, options?: ApiQueryOptions) {
  return (_target: Function, context: ClassMethodDecoratorContext): void => {
    const entry: ApiQueryMeta = { name, ...options }
    addToMapMeta(context.metadata!, API_QUERIES, String(context.name), [entry])
  }
}
