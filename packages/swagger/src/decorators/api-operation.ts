import { createMethodDecorator, setInMapMeta } from '@miiajs/core'
import { API_OPERATIONS } from '../constants.js'
import type { ApiOperationOptions } from '../types.js'

export const ApiOperation = createMethodDecorator<[options: ApiOperationOptions]>((_target, context, options) => {
  setInMapMeta(context.metadata!, API_OPERATIONS, String(context.name), options)
})
