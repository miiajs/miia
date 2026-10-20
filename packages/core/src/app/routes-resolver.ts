import type { Container } from '../di-container.js'
import { Logger } from '../logger.js'
import { getMeta, PREFIX } from '../decorators/index.js'
import type { Router } from '../router.js'
import type { Constructor } from '../types.js'
import { joinPaths } from '../utils/index.js'
import { RouterExplorer } from './router-explorer.js'
import type { ModuleNode } from './module-graph.js'

export class RoutesResolver {
  private logger = new Logger(RoutesResolver.name)
  private routerExplorer: RouterExplorer

  constructor(
    private router: Router,
    private container: Container,
  ) {
    this.routerExplorer = new RouterExplorer(router, container)
  }

  /** `owners`: the other modules that own the controller; its guards are checked from them too. */
  resolve(controller: Constructor, modulePrefix: string, node: ModuleNode, owners?: readonly ModuleNode[]): void {
    if (!this.container.has(controller)) {
      this.container.register(controller, () => new controller(), 'singleton', undefined, node)
    }

    const instance = this.container.resolve(controller)
    const prefix = getMeta<string>(controller, PREFIX) ?? ''
    const fullPrefix = joinPaths(modulePrefix, prefix)

    this.logger.log(`${controller.name} {/${joinPaths(this.router.globalPrefix, fullPrefix)}}`)

    this.routerExplorer.explore(instance, controller, fullPrefix, node, owners)
  }
}
