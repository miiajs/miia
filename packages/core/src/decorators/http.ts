import type { HttpMethod, RouteDefinition, RouteOptions, RouteOptionsWithoutBody, ZodLike } from '../types.js'
import { BODY_SCHEMAS, PARAMS_SCHEMAS, QUERY_SCHEMAS, ROUTES, pushMeta, setInMapMeta } from './metadata.js'
import { createMethodDecorator } from './create-decorator.js'

type RouteMethodDecorator = (target: Function, context: ClassMethodDecoratorContext) => void

export interface RouteDecorator<O> {
  (path?: string, options?: O): RouteMethodDecorator
  (options: O): RouteMethodDecorator
}

const BODYLESS = new Set<HttpMethod>(['GET', 'HEAD', 'OPTIONS'])

const SCHEMA_SLOTS = [
  ['params', PARAMS_SCHEMAS],
  ['query', QUERY_SCHEMAS],
  ['body', BODY_SCHEMAS],
] as const

function createRouteDecorator<O extends RouteOptions | RouteOptionsWithoutBody>(method: HttpMethod): RouteDecorator<O> {
  const decorator = `@${method[0]}${method.slice(1).toLowerCase()}`
  const bodyless = BODYLESS.has(method)

  return createMethodDecorator<[pathOrOptions?: string | RouteOptions, options?: RouteOptions]>(
    (_target, context, pathOrOptions, maybeOptions) => {
      const meta = context.metadata!
      const handlerName = String(context.name)
      const isOptions = typeof pathOrOptions === 'object' && pathOrOptions !== null
      const path = isOptions ? '' : (pathOrOptions ?? '')
      const options = (isOptions ? pathOrOptions : maybeOptions) ?? {}

      if (bodyless) {
        if (options.body !== undefined) {
          throw new TypeError(
            `${decorator} takes no body schema: ${method} has no request body (handler '${handlerName}')`,
          )
        }
        if ((meta[BODY_SCHEMAS] as Map<string, ZodLike> | undefined)?.has(handlerName)) {
          throw new TypeError(
            `${decorator} cannot share handler '${handlerName}' with a route that declares a body schema: ${method} has no request body`,
          )
        }
      } else if (options.body !== undefined) {
        const bodylessRoute = (meta[ROUTES] as RouteDefinition[] | undefined)?.find(
          (route) => route.handlerName === handlerName && BODYLESS.has(route.method),
        )
        if (bodylessRoute) {
          throw new TypeError(
            `${decorator} declares a body schema, but handler '${handlerName}' also serves ${bodylessRoute.method}, which has no request body`,
          )
        }
      }

      for (const [key, slot] of SCHEMA_SLOTS) {
        const schema = options[key]
        const existing = (meta[slot] as Map<string, ZodLike> | undefined)?.get(handlerName)
        if (schema !== undefined && existing !== undefined && existing !== schema) {
          throw new TypeError(
            `${decorator} declares a different ${key} schema than another route on handler '${handlerName}': routes on one handler share their schemas`,
          )
        }
      }

      pushMeta<RouteDefinition>(meta, ROUTES, { method, path, handlerName })
      for (const [key, slot] of SCHEMA_SLOTS) {
        const schema = options[key]
        if (schema !== undefined) setInMapMeta(meta, slot, handlerName, schema)
      }
    },
  )
}

export const Get: RouteDecorator<RouteOptionsWithoutBody> = createRouteDecorator('GET')
export const Post: RouteDecorator<RouteOptions> = createRouteDecorator('POST')
export const Put: RouteDecorator<RouteOptions> = createRouteDecorator('PUT')
export const Patch: RouteDecorator<RouteOptions> = createRouteDecorator('PATCH')
export const Delete: RouteDecorator<RouteOptions> = createRouteDecorator('DELETE')
export const Head: RouteDecorator<RouteOptionsWithoutBody> = createRouteDecorator('HEAD')
export const Options: RouteDecorator<RouteOptionsWithoutBody> = createRouteDecorator('OPTIONS')
