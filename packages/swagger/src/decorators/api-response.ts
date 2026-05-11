import { addToMapMeta } from '@miiajs/core'
import { API_RESPONSES } from '../constants.js'
import type { ApiResponseMeta, ApiResponseOptions } from '../types.js'

export function ApiResponse(status: number, options?: ApiResponseOptions) {
  return (_target: Function, context: ClassMethodDecoratorContext): void => {
    const entry: ApiResponseMeta = { status, ...options }
    addToMapMeta(context.metadata!, API_RESPONSES, String(context.name), [entry])
  }
}
