import type { Container } from '../di-container.js'
import { Logger } from '../logger.js'
import {
  getMeta,
  CLASS_MW,
  CLASS_GUARDS,
  METHOD_GUARDS,
  METHOD_MW,
  ROUTES,
  STATUSES,
  SKIP_GUARDS,
  GUARD_FACTORY,
} from '../decorators/index.js'
import { guardToMiddleware } from '../middleware.js'
import type { Router } from '../router.js'
import type { Constructor, Guard, HttpMethod, Middleware, RequestContext, RouteDefinition } from '../types.js'
import { joinPaths } from '../utils/index.js'

export class RouterExplorer {
  private logger = new Logger(RouterExplorer.name)

  constructor(
    private router: Router,
    private container: Container,
  ) {}

  explore(instance: any, controller: Constructor, controllerPrefix: string): void {
    const ctrlMws = getMeta<Middleware[]>(controller, CLASS_MW) ?? []
    const ctrlGuards = getMeta<Guard[]>(controller, CLASS_GUARDS) ?? []
    const routes = getMeta<RouteDefinition[]>(controller, ROUTES) ?? []
    const mwMap = getMeta<Map<string, Middleware[]>>(controller, METHOD_MW)
    const guardMap = getMeta<Map<string, Guard[]>>(controller, METHOD_GUARDS)
    const statusMap = getMeta<Map<string, number>>(controller, STATUSES)

    for (const route of routes) {
      const fullPath = joinPaths(controllerPrefix, route.path)
      const handler = (instance as any)[route.handlerName].bind(instance)

      const methodMws = mwMap?.get(route.handlerName) ?? []
      const methodGuards = guardMap?.get(route.handlerName) ?? []
      const customStatus = statusMap?.get(route.handlerName)

      const skipSet = getSkipSet(controller, route.handlerName)
      const ctrlGuardMws = this.resolveGuards(filterGuards(ctrlGuards, skipSet))
      const methodGuardMws = this.resolveGuards(filterGuards(methodGuards, skipSet))

      const routeMws: Middleware[] = [...ctrlGuardMws, ...ctrlMws, ...methodGuardMws, ...methodMws]

      const finalHandler = customStatus
        ? (ctx: RequestContext) => {
            ctx.res.status(customStatus)
            return handler(ctx)
          }
        : handler

      this.router.add(route.method, fullPath, finalHandler, {
        middlewares: routeMws,
        skippedGuardClasses: skipSet,
      })

      this.logger.log(`Mapped {/${fullPath}, ${route.method}} route`)
    }
  }

  private resolveGuards(guards: Guard[]): Middleware[] {
    return guards.map((guardCtor) => {
      if (!this.container.has(guardCtor)) {
        this.container.register(guardCtor, () => new guardCtor(), 'singleton')
      }
      const instance = this.container.resolve<any>(guardCtor)
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
