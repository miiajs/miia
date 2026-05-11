import { addToMapMeta } from '@miiajs/core'
import { API_PARAMS } from '../constants.js'
import type { ApiParamMeta, ApiParamOptions } from '../types.js'

export function ApiParam(name: string, options?: ApiParamOptions) {
  return (_target: Function, context: ClassMethodDecoratorContext): void => {
    const entry: ApiParamMeta = { name, ...options }
    addToMapMeta(context.metadata!, API_PARAMS, String(context.name), [entry])
  }
}
