import type { Container } from '../di-container.js'
import { Logger } from '../logger.js'
import { getMeta, PREFIX } from '../decorators/index.js'
import type { Router } from '../router.js'
import type { Constructor } from '../types.js'
import { joinPaths } from '../utils/index.js'
import { RouterExplorer } from './router-explorer.js'

export class RoutesResolver {
  private logger = new Logger(RoutesResolver.name)
  private routerExplorer: RouterExplorer

  constructor(
    router: Router,
    private container: Container,
  ) {
    this.routerExplorer = new RouterExplorer(router, container)
  }

  resolve(controller: Constructor, modulePrefix: string): void {
    if (!this.container.has(controller)) {
      this.container.register(controller, () => new controller(), 'singleton')
    }

    const instance = this.container.resolve(controller)
    const prefix = getMeta<string>(controller, PREFIX) ?? ''
    const fullPrefix = joinPaths(modulePrefix, prefix)

    this.logger.log(`${controller.name} {/${fullPrefix}}`)

    this.routerExplorer.explore(instance, controller, fullPrefix)
  }
}
