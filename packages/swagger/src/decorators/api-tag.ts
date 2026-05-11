import { createClassDecorator, setMeta } from '@miiajs/core'
import { API_TAG } from '../constants.js'

export const ApiTag = createClassDecorator<[...names: string[]]>((_target, context, ...names) => {
  setMeta(context.metadata!, API_TAG, names)
})
