import type { Container } from '../di-container.js'
import {
  BODY_LIMITS,
  BODY_READERS,
  BODY_SCHEMAS,
  CLASS_GUARDS,
  CLASS_MW,
  getMeta,
  METHOD_GUARDS,
  METHOD_MW,
  PARAMS_SCHEMAS,
  QUERY_SCHEMAS,
  ROUTES,
  SKIP_GUARDS,
  STATUSES,
} from '../decorators/index.js'
import { guardToMiddleware } from '../middleware.js'
import { isSkipped, type Router } from '../router.js'
import type {
  BodyReader,
  CanActivate,
  Constructor,
  Guard,
  Middleware,
  RequestContext,
  RouteDefinition,
  ZodLike,
} from '../types.js'
import { joinPaths } from '../utils/index.js'
import { createValidationMiddleware, jsonBodyReader } from '../validation.js'
import type { ModuleNode } from './module-graph.js'

export class RouterExplorer {
  constructor(
    private router: Router,
    private container: Container,
  ) {}

  /** `owners`: the other modules that own the controller, e.g. the other names of its module class. */
  explore(
    instance: any,
    controller: Constructor,
    controllerPrefix: string,
    node: ModuleNode,
    owners: readonly ModuleNode[] = [],
  ): void {
    const ctrlMws = getMeta<Middleware[]>(controller, CLASS_MW) ?? []
    const ctrlGuards = getMeta<Guard[]>(controller, CLASS_GUARDS) ?? []
    const routes = getMeta<RouteDefinition[]>(controller, ROUTES) ?? []
    const mwMap = getMeta<Map<string, Middleware[]>>(controller, METHOD_MW)
    const guardMap = getMeta<Map<string, Guard[]>>(controller, METHOD_GUARDS)
    const statusMap = getMeta<Map<string, number>>(controller, STATUSES)
    const bodyLimitMap = getMeta<Map<string, number>>(controller, BODY_LIMITS)
    const bodySchemaMap = getMeta<Map<string, ZodLike>>(controller, BODY_SCHEMAS)
    const querySchemaMap = getMeta<Map<string, ZodLike>>(controller, QUERY_SCHEMAS)
    const paramsSchemaMap = getMeta<Map<string, ZodLike>>(controller, PARAMS_SCHEMAS)
    const bodyReaderMap = getMeta<Map<string, BodyReader>>(controller, BODY_READERS)
    // Built and checked on the first route that runs the guard: one skipped on every route is never built.
    const guardMws = new Map<Guard, Middleware>()
    const toMiddlewares = (guards: Guard[], skipSet: Set<any> | null): Middleware[] => {
      const result: Middleware[] = []
      for (const guard of guards) {
        if (skipSet && isSkipped(guard, skipSet)) continue
        let mw = guardMws.get(guard)
        if (!mw) guardMws.set(guard, (mw = this.resolveGuard(guard, controller, node, owners)))
        result.push(mw)
      }
      return result
    }

    for (const route of routes) {
      const fullPath = joinPaths(controllerPrefix, route.path)
      const handler = (instance as any)[route.handlerName].bind(instance)

      const methodMws = mwMap?.get(route.handlerName) ?? []
      const methodGuards = guardMap?.get(route.handlerName) ?? []
      const customStatus = statusMap?.get(route.handlerName)
      // method-level @BodyLimit > class-level ('*') > Router.defaultBodyLimit (via undefined)
      const bodyLimit = bodyLimitMap?.get(route.handlerName) ?? bodyLimitMap?.get('*')

      const skipSet = getSkipSet(controller, route.handlerName)
      const ctrlGuardMws = toMiddlewares(ctrlGuards, skipSet)
      const methodGuardMws = toMiddlewares(methodGuards, skipSet)

      const validation = createValidationMiddleware(
        {
          params: paramsSchemaMap?.get(route.handlerName),
          query: querySchemaMap?.get(route.handlerName),
          body: bodySchemaMap?.get(route.handlerName),
        },
        bodyReaderMap?.get(route.handlerName) ?? jsonBodyReader,
      )

      const routeMws: Middleware[] = [...ctrlGuardMws, ...ctrlMws, ...methodGuardMws, ...methodMws]
      // Last: guards and route middleware (@Multipart's form state among them) run first.
      if (validation) routeMws.push(validation)

      const finalHandler = customStatus
        ? (ctx: RequestContext) => {
            ctx.res.status(customStatus)
            return handler(ctx)
          }
        : handler

      this.router.add(route.method, fullPath, finalHandler, {
        middlewares: routeMws,
        skippedGuardClasses: skipSet,
        bodyLimit,
      })
    }
  }

  /** Checked from every module of the controller: the guard itself if a module declares it, else what it injects. */
  private resolveGuard(
    guardCtor: Guard,
    controller: Constructor,
    consumer: ModuleNode,
    owners: readonly ModuleNode[],
  ): Middleware {
    if (!this.container.has(guardCtor)) this.container.registerGuard(guardCtor)
    const instance = this.container.resolve<CanActivate>(guardCtor)
    this.container.checkGuard(guardCtor, consumer, controller)
    for (const owner of owners) this.container.checkGuard(guardCtor, owner, controller)
    return guardToMiddleware(instance)
  }
}

function getSkipSet(controller: Constructor, handlerName: string): Set<any> | null {
  const map = getMeta<Map<string, Set<any>>>(controller, SKIP_GUARDS)
  if (!map) return null
  const methodSet = map.get(handlerName)
  const classSet = map.get('*')
  if (!methodSet && !classSet) return null
  if (methodSet && classSet) return new Set([...classSet, ...methodSet])
  return methodSet ?? classSet ?? null
}
