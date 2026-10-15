import type { Container } from '../di-container.js'
import { formatToken } from '../di-token-format.js'
import { Logger } from '../logger.js'
import { getMeta, setMeta, MODULE, INJECTABLE, PREFIX, RESOLVED_PREFIX } from '../decorators/index.js'
import type { InjectableMeta } from '../decorators/index.js'
import type { Router } from '../router.js'
import type {
  AnyToken,
  ConfiguredModule,
  Constructor,
  FactoryProvider,
  ModuleOptions,
  ProviderDefinition,
} from '../types.js'
import { RoutesResolver } from './routes-resolver.js'
import { isOverride, OVERRIDE_KIND } from './overrides.js'
import type { OverrideDescriptor } from './overrides.js'
import { joinPaths } from '../utils/index.js'

interface PendingRoute {
  controller: Constructor
  prefix: string
}

interface ConfiguredEntry {
  module: ConfiguredModule
  /** The module whose `imports` hold it, or `register()`. */
  host: string
}

const NESTED_OVERRIDE = '[Miia] override descriptors are only allowed at the top level of register()'

function formatPair(cls: Constructor, name: string): string {
  return name ? `${formatToken(cls)} (name '${name}')` : formatToken(cls)
}

export class ModuleLoader {
  private logger = new Logger(ModuleLoader.name)
  /** By the pair (class, name); a bare class is the pair (class, ''). */
  private processedModules = new Map<Constructor, Set<string>>()
  private registeredTokens = new Set<AnyToken>()
  private configured = new Map<Constructor, Map<string, ConfiguredEntry>>()
  private providerOverrides = new Map<AnyToken, () => unknown>()
  private usedOverrides = new Set<AnyToken>()
  private routesResolver: RoutesResolver
  private pendingRoutes: PendingRoute[] = []

  constructor(
    router: Router,
    private container: Container,
  ) {
    this.routesResolver = new RoutesResolver(router, container)
  }

  load(...items: (Constructor | ConfiguredModule | OverrideDescriptor)[]): void {
    const modules: (Constructor | ConfiguredModule)[] = []
    const moduleOverrides: ConfiguredModule[] = []
    for (const item of items) {
      if (!isOverride(item)) modules.push(item)
      else if (item[OVERRIDE_KIND] === 'provider') this.providerOverrides.set(item.token, item.factory)
      else moduleOverrides.push(item.module)
    }

    const visited = new Set<Constructor>()
    for (const mod of modules) {
      this.collect(mod, 'register()', visited)
    }

    for (const replacement of moduleOverrides) {
      const name = replacement.name ?? ''
      const entry = this.configured.get(replacement.module)?.get(name)
      if (!entry) {
        const pair = formatPair(replacement.module, name)
        const cls = formatToken(replacement.module)
        throw new Error(
          `[Miia] override(${pair}): ${pair} is not configured in the loaded graph - ` +
            `if a module imports ${cls} bare and expects the root to configure it, register it alongside: ` +
            `TestApp.create(FeatureModule, ${cls}.configure(...))`,
        )
      }
      entry.module = replacement
    }

    // Tokens already in the container (built-ins, provide()) never pass through registerProvider(),
    // and phase 2 constructs controllers and guards - replace them before anything is built.
    for (const token of this.providerOverrides.keys()) {
      if (this.container.has(token)) this.applyOverride(token)
    }

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

    for (const token of this.providerOverrides.keys()) {
      if (!this.usedOverrides.has(token)) {
        const name = formatToken(token)
        throw new Error(
          `[Miia] override(${name}): no loaded module provides ${name} - use provide() for a module-less test`,
        )
      }
    }
  }

  /**
   * Records every configured module by its pair (class, name) before phase 1, so a bare import
   * resolves to it whatever the order, and a second configuration of a pair throws.
   */
  private collect(item: Constructor | ConfiguredModule, host: string, visited: Set<Constructor>): void {
    if (isOverride(item)) throw new Error(NESTED_OVERRIDE)

    let moduleCtor: Constructor
    if (typeof item === 'function') {
      if (visited.has(item)) return
      visited.add(item)
      moduleCtor = item
    } else {
      moduleCtor = item.module
      const name = item.name ?? ''
      let byName = this.configured.get(moduleCtor)
      const seen = byName?.get(name)
      if (seen) {
        if (seen.module === item) return
        const cls = formatToken(moduleCtor)
        throw new Error(
          `[Miia] ${formatPair(moduleCtor, name)} is configured twice (${seen.host}, ${host}) - configure it once; ` +
            'for another connection use a different name; ' +
            `in tests, replace it with TestApp.override(${cls}, ${cls}.configure(...))`,
        )
      }
      if (!byName) this.configured.set(moduleCtor, (byName = new Map()))
      byName.set(name, { module: item, host })
    }

    const imports = getMeta<ModuleOptions>(moduleCtor, MODULE)?.imports
    if (imports) {
      for (const imp of imports) {
        this.collect(imp, formatToken(moduleCtor), visited)
      }
    }
  }

  private processModule(modOrConfigured: Constructor | ConfiguredModule, parentPrefix = ''): void {
    if (isOverride(modOrConfigured)) throw new Error(NESTED_OVERRIDE)

    let moduleCtor: Constructor
    let name = ''
    if (typeof modOrConfigured === 'function') {
      moduleCtor = modOrConfigured
    } else {
      moduleCtor = modOrConfigured.module
      name = modOrConfigured.name ?? ''
    }
    // The collected (possibly overridden) configuration; a bare class gets the unnamed one, if any.
    const extraProviders = this.configured.get(moduleCtor)?.get(name)?.module.providers ?? []

    let processed = this.processedModules.get(moduleCtor)
    if (processed?.has(name)) return
    if (!processed) this.processedModules.set(moduleCtor, (processed = new Set()))
    processed.add(name)

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
        // Controllers are registered in phase 2, only if absent - an override has to be there first.
        this.applyOverride(controller)
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
            `[Miia] Duplicate provider: ${formatToken(provider)} is already registered. Remove it from one of the modules.`,
          )
        }
        return
      }
      if (this.registerOverride(provider)) return
      const scope = getMeta<InjectableMeta>(provider, INJECTABLE)?.scope ?? 'singleton'
      this.container.register(provider, () => new provider(), scope)
      this.registeredTokens.add(provider)
    } else {
      const fp = provider as FactoryProvider
      if (this.container.has(fp.token)) {
        if (this.registeredTokens.has(fp.token)) {
          throw new Error(
            `[Miia] Duplicate provider: ${formatToken(fp.token)} is already registered. Remove it from one of the modules.`,
          )
        }
        return
      }
      if (this.registerOverride(fp.token)) return
      this.container.register(fp.token, fp.factory, fp.scope)
      this.registeredTokens.add(fp.token)
    }
  }

  /** An overridden provider still counts as registered, so a second module declaring it is a duplicate. */
  private registerOverride(token: AnyToken): boolean {
    if (!this.applyOverride(token)) return false
    this.registeredTokens.add(token)
    return true
  }

  private applyOverride(token: AnyToken): boolean {
    const factory = this.providerOverrides.get(token)
    if (!factory) return false
    this.container.register(token, factory, 'singleton')
    this.usedOverrides.add(token)
    return true
  }
}
