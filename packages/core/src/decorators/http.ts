import { ROUTES, pushMeta } from './metadata.js'
import { createMethodDecorator } from './create-decorator.js'

export const Get = createMethodDecorator<[path?: string]>((_target, context, path = '') => {
  pushMeta(context.metadata!, ROUTES, { method: 'GET', path, handlerName: String(context.name) })
})

export const Post = createMethodDecorator<[path?: string]>((_target, context, path = '') => {
  pushMeta(context.metadata!, ROUTES, { method: 'POST', path, handlerName: String(context.name) })
})

export const Put = createMethodDecorator<[path?: string]>((_target, context, path = '') => {
  pushMeta(context.metadata!, ROUTES, { method: 'PUT', path, handlerName: String(context.name) })
})

export const Patch = createMethodDecorator<[path?: string]>((_target, context, path = '') => {
  pushMeta(context.metadata!, ROUTES, { method: 'PATCH', path, handlerName: String(context.name) })
})

export const Delete = createMethodDecorator<[path?: string]>((_target, context, path = '') => {
  pushMeta(context.metadata!, ROUTES, { method: 'DELETE', path, handlerName: String(context.name) })
})

export const Head = createMethodDecorator<[path?: string]>((_target, context, path = '') => {
  pushMeta(context.metadata!, ROUTES, { method: 'HEAD', path, handlerName: String(context.name) })
})

export const Options = createMethodDecorator<[path?: string]>((_target, context, path = '') => {
  pushMeta(context.metadata!, ROUTES, { method: 'OPTIONS', path, handlerName: String(context.name) })
})
