import type { Container } from '../di-container.js'
import { Logger } from '../logger.js'
import { getMeta, setMeta, MODULE, INJECTABLE, PREFIX, RESOLVED_PREFIX } from '../decorators/index.js'
import type { InjectableMeta } from '../decorators/index.js'
import type { Router } from '../router.js'
import type { ConfiguredModule, Constructor, FactoryProvider, ModuleOptions, ProviderDefinition } from '../types.js'
import { RoutesResolver } from './routes-resolver.js'
import { joinPaths } from '../utils/index.js'

interface PendingRoute {
  controller: Constructor
  prefix: string
}

export class ModuleLoader {
  private logger = new Logger(ModuleLoader.name)
  private processedModules = new Set<Constructor>()
  private registeredTokens = new Set<Constructor | string>()
  private routesResolver: RoutesResolver
  private pendingRoutes: PendingRoute[] = []

  constructor(
    router: Router,
    private container: Container,
  ) {
    this.routesResolver = new RoutesResolver(router, container)
  }

  load(...modules: (Constructor | ConfiguredModule)[]): void {
    // Phase 1: Load modules, register providers
    for (const mod of modules) {
      this.processModule(mod)
    }

    // Phase 2: Resolve routes
    for (const { controller, prefix } of this.pendingRoutes) {
      this.routesResolver.resolve(controller, prefix)
      const ctrlPrefix = getMeta<string>(controller, PREFIX) ?? ''
      const resolvedPrefix = joinPaths(prefix, ctrlPrefix)
      // Expose the fully-resolved prefix as class metadata so DiscoveryService
      // consumers (e.g. @miiajs/swagger) can pair controllers with their live
      // routing prefix without reaching into ModuleLoader internals.
      const classMeta = (controller as { [Symbol.metadata]?: Record<string | symbol, unknown> })[Symbol.metadata]
      if (classMeta) setMeta(classMeta, RESOLVED_PREFIX, resolvedPrefix)
    }
    this.pendingRoutes = []
  }

  private processModule(modOrConfigured: Constructor | ConfiguredModule, parentPrefix = ''): void {
    let moduleCtor: Constructor
    let extraProviders: ProviderDefinition[] = []

    if (typeof modOrConfigured === 'function') {
      moduleCtor = modOrConfigured
    } else {
      moduleCtor = modOrConfigured.module
      extraProviders = modOrConfigured.providers ?? []
    }

    if (this.processedModules.has(moduleCtor)) return
    this.processedModules.add(moduleCtor)

    const meta = getMeta<ModuleOptions>(moduleCtor, MODULE)
    const prefix = joinPaths(parentPrefix, meta?.prefix ?? '')

    for (const provider of extraProviders) {
      this.registerProvider(provider)
    }

    if (meta?.imports) {
      for (const imp of meta.imports) {
        this.processModule(imp, prefix)
      }
    }

    if (meta?.providers) {
      for (const provider of meta.providers) {
        this.registerProvider(provider)
      }
    }

    if (meta?.controllers) {
      for (const controller of meta.controllers) {
        this.pendingRoutes.push({ controller, prefix })
      }
    }

    if (!this.container.has(moduleCtor)) {
      this.container.register(moduleCtor, () => new moduleCtor(), 'singleton')
    }

    this.logger.log(`${moduleCtor.name} dependencies initialized`)
  }

  private registerProvider(provider: ProviderDefinition): void {
    if (typeof provider === 'function') {
      if (this.container.has(provider)) {
        if (this.registeredTokens.has(provider)) {
          throw new Error(
            `[Miia] Duplicate provider: ${provider.name} is already registered. Remove it from one of the modules.`,
          )
        }
        return
      }
      const meta = getMeta<InjectableMeta>(provider, INJECTABLE)
      const scope = meta?.scope ?? 'singleton'
      const token = meta?.token

      if (token) {
        this.container.register(token, () => new provider(), scope)
        this.container.register(provider, (resolve) => resolve(token), scope)
        this.registeredTokens.add(token)
      } else {
        this.container.register(provider, () => new provider(), scope)
      }
      this.registeredTokens.add(provider)
    } else {
      const fp = provider as FactoryProvider
      if (this.container.has(fp.token)) {
        if (this.registeredTokens.has(fp.token)) {
          throw new Error(
            `[Miia] Duplicate provider: ${String(fp.token)} is already registered. Remove it from one of the modules.`,
          )
        }
        return
      }
      this.container.register(fp.token, fp.factory, fp.scope)
      this.registeredTokens.add(fp.token)
    }
  }
}
