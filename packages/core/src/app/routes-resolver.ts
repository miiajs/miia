import type { Container } from '../di-container.js'
import { Logger } from '../logger.js'
import type { Router } from '../router.js'
import type { Constructor } from '../types.js'
import { joinPaths } from '../utils/index.js'
import { RouterExplorer } from './router-explorer.js'
import type { ModuleNode } from './module-graph.js'

export class RoutesResolver {
  private logger = new Logger('RoutesResolver')
  private routerExplorer: RouterExplorer

  constructor(
    private router: Router,
    private container: Container,
  ) {
    this.routerExplorer = new RouterExplorer(router, container)
  }

  /**
   * `prefix`: of the module and the controller together. `owners`: the other modules that own the controller;
   * its guards are checked from them too.
   */
  resolve(controller: Constructor, prefix: string, node: ModuleNode, owners?: readonly ModuleNode[]): void {
    const instance = this.container.resolve(controller)

    this.logger.log(`${controller.name} {/${joinPaths(this.router.globalPrefix, prefix)}}`)

    this.routerExplorer.explore(instance, controller, prefix, node, owners)
  }
}
