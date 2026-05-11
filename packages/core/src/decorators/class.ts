import type { ModuleOptions, Scope } from '../types.js'
import { INJECTABLE, MODULE, PREFIX, setMeta } from './metadata.js'
import type { InjectableMeta } from './metadata.js'
import { createClassDecorator } from './create-decorator.js'

export interface InjectableOptions {
  scope?: Scope
  token?: string
}

export const Injectable = createClassDecorator<[options?: InjectableOptions]>((_target, context, options) => {
  setMeta<InjectableMeta>(context.metadata!, INJECTABLE, {
    scope: options?.scope ?? 'singleton',
    token: options?.token,
  })
})

export const Controller = createClassDecorator<[prefix?: string]>((_target, context, prefix = '') => {
  setMeta(context.metadata!, PREFIX, prefix)
})

export const Module = createClassDecorator<[options: ModuleOptions]>((_target, context, options) => {
  setMeta(context.metadata!, MODULE, options)
})
