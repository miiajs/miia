import type { Container } from '../di-container.js'
import { Logger } from '../logger.js'
import {
  BODY_LIMITS,
  BODY_READERS,
  BODY_SCHEMAS,
  CLASS_GUARDS,
  CLASS_MW,
  getMeta,
  GUARD_FACTORY,
  METHOD_GUARDS,
  METHOD_MW,
  PARAMS_SCHEMAS,
  QUERY_SCHEMAS,
  ROUTES,
  SKIP_GUARDS,
  STATUSES,
} from '../decorators/index.js'
import { guardToMiddleware } from '../middleware.js'
import type { Router } from '../router.js'
import type { BodyReader, Constructor, Guard, Middleware, RequestContext, RouteDefinition, ZodLike } from '../types.js'
import { joinPaths } from '../utils/index.js'
import { createValidationMiddleware, jsonBodyReader } from '../validation.js'
import type { ModuleNode } from './module-graph.js'

export class RouterExplorer {
  private logger = new Logger(RouterExplorer.name)

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
    const logPrefix = this.router.globalPrefix

    for (const route of routes) {
      const fullPath = joinPaths(controllerPrefix, route.path)
      const handler = (instance as any)[route.handlerName].bind(instance)

      const methodMws = mwMap?.get(route.handlerName) ?? []
      const methodGuards = guardMap?.get(route.handlerName) ?? []
      const customStatus = statusMap?.get(route.handlerName)
      // method-level @BodyLimit > class-level ('*') > Router.defaultBodyLimit (via undefined)
      const bodyLimit = bodyLimitMap?.get(route.handlerName) ?? bodyLimitMap?.get('*')

      const skipSet = getSkipSet(controller, route.handlerName)
      const ctrlGuardMws = this.resolveGuards(filterGuards(ctrlGuards, skipSet), controller, node, owners)
      const methodGuardMws = this.resolveGuards(filterGuards(methodGuards, skipSet), controller, node, owners)

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

      this.logger.log(`Mapped {/${joinPaths(logPrefix, fullPath)}, ${route.method}} route`)
    }
  }

  /** Checked from every module of the controller: the guard itself if a module declares it, else what it injects. */
  private resolveGuards(
    guards: Guard[],
    controller: Constructor,
    consumer: ModuleNode,
    owners: readonly ModuleNode[],
  ): Middleware[] {
    return guards.map((guardCtor) => {
      if (!this.container.has(guardCtor)) this.container.registerGuard(guardCtor)
      const instance = this.container.resolve<any>(guardCtor)
      this.container.checkGuard(guardCtor, consumer, controller)
      for (const owner of owners) this.container.checkGuard(guardCtor, owner, controller)
      return guardToMiddleware((ctx) => instance.canActivate(ctx))
    })
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

function shouldSkip(guardCtor: Guard, skipSet: Set<any>): boolean {
  if (skipSet.has(guardCtor)) return true
  const factory = (guardCtor as any)[GUARD_FACTORY]
  return factory != null && skipSet.has(factory)
}

function filterGuards(guards: Guard[], skipSet: Set<any> | null): Guard[] {
  if (!skipSet) return guards
  return guards.filter((g) => !shouldSkip(g, skipSet))
}
