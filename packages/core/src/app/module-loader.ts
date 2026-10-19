import { type Container, REQUEST_CONTEXT, requestContextReplaced } from '../di-container.js'
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
  ForwardRef,
  ModuleOptions,
  ProviderDefinition,
} from '../types.js'
import { RoutesResolver } from './routes-resolver.js'
import { isOverride, OVERRIDE_KIND } from './overrides.js'
import type { OverrideDescriptor } from './overrides.js'
import { FORWARD_REF, isForwardRef } from './forward-ref.js'
import { ModuleGraph } from './module-graph.js'
import type { ModuleNode } from './module-graph.js'
import { joinPaths } from '../utils/index.js'

interface PendingRoute {
  controller: Constructor
  prefix: string
  node: ModuleNode
}

/** The node that mounts the controllers of a module class, and the other names of the class: they own them too. */
interface MountedControllers {
  node: ModuleNode
  prefix: string
  owners: ModuleNode[]
}

interface ConfiguredEntry {
  module: ConfiguredModule
  /** `global` of the configuration the graph declares: an override inherits it. */
  global: boolean
}

type ModuleItem = Constructor | ConfiguredModule

const NESTED_OVERRIDE = '[Miia] override descriptors are only allowed at the top level of register()'

function formatPair(cls: Constructor, name: string): string {
  return name ? `${formatToken(cls)} (name '${name}')` : formatToken(cls)
}

function isConfiguredModule(value: unknown): value is ConfiguredModule {
  return typeof value === 'object' && value !== null && typeof (value as ConfiguredModule).module === 'function'
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`
}

export class ModuleLoader {
  private logger = new Logger(ModuleLoader.name)
  /** Tokens registered with `app.provide()`; a module that declares one is an error. */
  readonly provided = new Set<AnyToken>()
  private moduleGraph = new ModuleGraph()
  /** By the pair (class, name); a bare class is the pair (class, ''). */
  private nodes = new Map<Constructor, Map<string, ModuleNode>>()
  private processed = new Set<ModuleNode>()
  private owners = new Map<AnyToken, ModuleNode>()
  /** Tokens first registered from the `@Module` providers of a class: its other names own them too. */
  private staticTokens = new Set<AnyToken>()
  /** By module class: its controllers are mounted once, whatever the number of names. */
  private mountedControllers = new Map<Constructor, MountedControllers>()
  /** The node that registered a module class instance. */
  private moduleClassOwners = new Map<Constructor, ModuleNode>()
  private configured = new Map<Constructor, Map<string, ConfiguredEntry>>()
  private forwardRefs = new WeakMap<ForwardRef<ModuleItem>, ModuleItem>()
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

  get graph(): ModuleGraph {
    return this.moduleGraph
  }

  load(...items: (Constructor | ConfiguredModule | OverrideDescriptor)[]): void {
    const root = this.moduleGraph.root
    const modules: ModuleItem[] = []
    const moduleOverrides: ConfiguredModule[] = []
    items.forEach((item, index) => {
      if (!isOverride(item)) modules.push(this.unwrap(item, root, 'imports', index) as ModuleItem)
      else if (item[OVERRIDE_KIND] === 'module') moduleOverrides.push(item.module)
      else if (item.token === REQUEST_CONTEXT) throw requestContextReplaced('override')
      else this.providerOverrides.set(item.token, item.factory)
    })

    for (const mod of modules) {
      this.addImport(root, this.collect(mod, root))
    }

    for (const replacement of moduleOverrides) {
      const name = replacement.name ?? ''
      const entry = this.configured.get(replacement.module)?.get(name)
      const pair = formatPair(replacement.module, name)
      if (!entry) {
        const cls = formatToken(replacement.module)
        throw new Error(
          `[Miia] override(${pair}): ${pair} is not configured in the loaded graph - ` +
            `if a module imports ${cls} bare and expects the root to configure it, register it alongside: ` +
            `TestApp.create(FeatureModule, ${cls}.configure(...))`,
        )
      }
      const global = entry.global || getMeta<ModuleOptions>(replacement.module, MODULE)?.global === true
      if (replacement.global !== undefined && replacement.global !== global) {
        throw new Error(
          `[Miia] override(${pair}): the replacement sets global: ${replacement.global}, ` +
            `but the configured module it replaces ${global ? 'is global' : 'does not'} - ` +
            'leave global out, it is inherited',
        )
      }
      entry.module = replacement
    }

    // Tokens already in the container (built-ins, provide()) never pass through registerProvider(),
    // and phase 2 constructs controllers and guards - replace them before anything is built.
    for (const token of this.providerOverrides.keys()) {
      if (this.container.has(token)) this.applyOverride(token, null)
    }

    // Phase 1: Load modules, register providers
    for (const mod of modules) {
      this.processModule(mod)
    }

    this.resolveExports()
    // From here on the container checks module boundaries: phase 2 constructs controllers and guards.
    this.container.graph = this.moduleGraph
    this.container.provided = this.provided

    // Phase 2: Resolve routes
    for (const { controller, prefix, node } of this.pendingRoutes) {
      const owners = this.mountedControllers.get(node.module!)?.owners ?? []
      if (owners.length > 0) {
        // The other names must own the entry before the controller is constructed.
        if (!this.container.has(controller)) {
          this.container.register(controller, () => new controller(), 'singleton', undefined, node)
        }
        for (const owner of owners) this.container.addOwner(controller, owner)
      }
      this.routesResolver.resolve(controller, prefix, node)
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
   * Builds the node of every pair (class, name) with its imports and, for a configured module, its host,
   * before phase 1. Every configuration is recorded here, so a bare import resolves to it whatever the
   * order, a second configuration of a pair throws, and so does one configure() result under two hosts.
   */
  private collect(item: ModuleItem, host: ModuleNode): ModuleNode {
    if (isOverride(item)) throw new Error(NESTED_OVERRIDE)

    const moduleCtor = typeof item === 'function' ? item : item.module
    const name = typeof item === 'function' ? '' : (item.name ?? '')
    let byName = this.nodes.get(moduleCtor)
    if (!byName) this.nodes.set(moduleCtor, (byName = new Map()))
    let node = byName.get(name)
    const created = !node
    if (!node) byName.set(name, (node = this.moduleGraph.createNode(formatPair(moduleCtor, name), moduleCtor, name)))

    if (typeof item !== 'function') {
      let entries = this.configured.get(moduleCtor)
      const seen = entries?.get(name)
      if (seen) {
        if (seen.module !== item) {
          const cls = formatToken(moduleCtor)
          throw new Error(
            `[Miia] ${node.label} is configured twice (${node.host!.importer}, ${host.importer}) - configure it once; ` +
              'for another connection use a different name; ' +
              `in tests, replace it with TestApp.override(${cls}, ${cls}.configure(...))`,
          )
        }
        // Two names of one module class share its own imports: the first stays the host.
        const sameClass = node.host!.module !== null && node.host!.module === host.module
        if (node.host !== host && !sameClass) {
          throw new Error(
            `[Miia] The same configured module ${node.label} is imported by ${node.host!.importer} and ${host.importer} - ` +
              'import it once and re-export it from that module, or make it global',
          )
        }
      } else {
        if (!entries) this.configured.set(moduleCtor, (entries = new Map()))
        entries.set(name, { module: item, global: item.global === true })
        node.host = host
      }
    }

    if (created) {
      const imports = getMeta<ModuleOptions>(moduleCtor, MODULE)?.imports
      imports?.forEach((imp, index) => {
        this.addImport(node, this.collect(this.unwrap(imp, node, 'imports', index) as ModuleItem, node))
      })
    }
    return node
  }

  private addImport(node: ModuleNode, imported: ModuleNode): void {
    if (!node.imports.includes(imported)) node.imports.push(imported)
  }

  /** An entry of `imports` / `exports` with a forwardRef unwrapped (once); `undefined` throws. */
  private unwrap(ref: unknown, node: ModuleNode, field: 'imports' | 'exports', index: number): unknown {
    if (ref === undefined || ref === null) {
      throw new Error(
        `[Miia] ${node.importer} ${field} ${ref} (index ${index}) - ` +
          'if two module files import each other, wrap both sides in forwardRef(() => X)',
      )
    }
    if (!isForwardRef(ref)) return ref
    let target = this.forwardRefs.get(ref)
    if (!target) {
      const value: unknown = ref[FORWARD_REF]()
      if (typeof value !== 'function' && !isConfiguredModule(value)) {
        throw new Error(
          `[Miia] forwardRef() in ${node.importer} \`${field}\` returned ${describeValue(value)} - ` +
            'expected a module class or a configure() result',
        )
      }
      this.forwardRefs.set(ref, (target = value as ModuleItem))
    }
    return target
  }

  private nodeOf(item: ModuleItem): ModuleNode | undefined {
    if (typeof item === 'function') return this.nodes.get(item)?.get('')
    return this.nodes.get(item.module)?.get(item.name ?? '')
  }

  private processModule(modOrConfigured: ModuleItem, parentPrefix = ''): void {
    if (isOverride(modOrConfigured)) throw new Error(NESTED_OVERRIDE)

    let moduleCtor: Constructor
    let name = ''
    if (typeof modOrConfigured === 'function') {
      moduleCtor = modOrConfigured
    } else {
      moduleCtor = modOrConfigured.module
      name = modOrConfigured.name ?? ''
    }
    const node = this.nodeOf(modOrConfigured)!
    if (this.processed.has(node)) return
    this.processed.add(node)

    // The collected (possibly overridden) configuration; a bare class gets the unnamed one, if any.
    const extraProviders = this.configured.get(moduleCtor)?.get(name)?.module.providers ?? []

    const meta = getMeta<ModuleOptions>(moduleCtor, MODULE)
    const prefix = joinPaths(parentPrefix, meta?.prefix ?? '')

    for (const provider of extraProviders) {
      this.registerProvider(provider, node)
    }

    meta?.imports?.forEach((imp, index) => {
      this.processModule(this.unwrap(imp, node, 'imports', index) as ModuleItem, prefix)
    })

    if (meta?.providers) {
      for (const provider of meta.providers) {
        this.registerProvider(provider, node, true)
      }
    }

    if (meta?.controllers?.length) {
      const mounted = this.mountedControllers.get(moduleCtor)
      if (mounted && mounted.prefix !== prefix) {
        throw new Error(
          `[Miia] ${node.label} resolves its controllers under /${prefix}, but ${mounted.node.label} already ` +
            `mounted them under /${mounted.prefix} - a module class configured under several names mounts its ` +
            'controllers once; give them one prefix',
        )
      }
      if (mounted) mounted.owners.push(node)
      else this.mountedControllers.set(moduleCtor, { node, prefix, owners: [] })
      for (const controller of meta.controllers) {
        node.owns.add(controller)
        if (mounted) continue
        // Controllers are registered in phase 2, only if absent - an override has to be there first.
        this.applyOverride(controller, node)
        this.pendingRoutes.push({ controller, prefix, node })
      }
    }

    const classOwner = this.moduleClassOwners.get(moduleCtor)
    if (classOwner) {
      // Another name of the class: one module instance, owned by every name.
      node.owns.add(moduleCtor)
      this.container.addOwner(moduleCtor, node)
    } else if (!this.container.has(moduleCtor)) {
      this.container.register(moduleCtor, () => new moduleCtor(), 'singleton', undefined, node)
      node.owns.add(moduleCtor)
      this.moduleClassOwners.set(moduleCtor, node)
    }

    this.logger.log(`${moduleCtor.name} dependencies initialized`)
  }

  /**
   * Fills `exports` and `global` of every node from `@Module` of its class and its configuration.
   * An export is an owned token or a module the node imports, matched by its pair (class, name).
   */
  private resolveExports(): void {
    for (const [moduleCtor, byName] of this.nodes) {
      const meta = getMeta<ModuleOptions>(moduleCtor, MODULE)
      for (const [name, node] of byName) {
        const entry = this.configured.get(moduleCtor)?.get(name)
        node.global = meta?.global === true || entry?.global === true
        node.hasExports = meta?.exports !== undefined || entry?.module.exports !== undefined
        meta?.exports?.forEach((ref, index) => this.addExport(node, ref, index))
        entry?.module.exports?.forEach((ref, index) => this.addExport(node, ref, index))
      }
    }
  }

  private addExport(node: ModuleNode, ref: unknown, index: number): void {
    const item = this.unwrap(ref, node, 'exports', index)
    if (node.owns.has(item as AnyToken)) {
      node.exportedTokens.add(item as AnyToken)
      return
    }
    const configured = isConfiguredModule(item)
    if (typeof item === 'function' || configured) {
      const target = this.nodeOf(item as ModuleItem)
      if (target && node.imports.includes(target)) {
        if (!node.reexports.includes(target)) node.reexports.push(target)
        return
      }
    }
    const exported = configured ? formatPair(item.module, item.name ?? '') : formatToken(item as AnyToken)
    throw new Error(
      `[Miia] ${node.label} exports ${exported}, which it neither provides nor imports - ` +
        'export its own providers or modules it imports',
    )
  }

  /** `isStatic`: from `@Module({ providers })` of the class, not from a configure() result. */
  private registerProvider(provider: ProviderDefinition, node: ModuleNode, isStatic = false): void {
    const token = typeof provider === 'function' ? provider : (provider as FactoryProvider).token
    const owner = this.owners.get(token)
    if (owner) {
      // Another name of the class: one instance, owned by every name.
      if (isStatic && owner !== node && owner.module === node.module && this.staticTokens.has(token)) {
        node.owns.add(token)
        this.container.addOwner(token, node)
        return
      }
      throw new Error(this.duplicateMessage(token, owner, node))
    }
    if (this.provided.has(token)) {
      const name = formatToken(token)
      throw new Error(
        `[Miia] provide(${name}): ${name} is declared by ${node.where} - replace it with override() instead`,
      )
    }
    // A built-in token declared by a module keeps the built-in.
    if (this.container.has(token)) return

    // An overridden provider still has its owner, so a second module declaring it is a duplicate.
    this.owners.set(token, node)
    node.owns.add(token)
    if (isStatic) this.staticTokens.add(token)
    if (this.applyOverride(token, node)) return
    if (typeof provider === 'function') {
      const scope = getMeta<InjectableMeta>(provider, INJECTABLE)?.scope ?? 'singleton'
      this.container.register(provider, () => new provider(), scope, undefined, node)
    } else {
      const fp = provider as FactoryProvider
      this.container.register(fp.token, fp.factory, fp.scope, fp.deps, node)
    }
  }

  private duplicateMessage(token: AnyToken, first: ModuleNode, second: ModuleNode): string {
    const name = formatToken(token)
    if (first === second) return `[Miia] ${name} is listed twice in ${first.where} providers`
    const advice =
      first.configured && second.configured
        ? 'configure it once, import that result in one module and re-export it'
        : "keep it in one module, add it to that module's exports, and import that module in the other"
    return `[Miia] ${name} is provided by both ${first.where} and ${second.where} - ${advice}`
  }

  private applyOverride(token: AnyToken, owner: ModuleNode | null): boolean {
    const factory = this.providerOverrides.get(token)
    if (!factory) return false
    // The replacement is a value or its own factory; the deps of the provider it replaces do not apply to it.
    this.container.register(token, factory, 'singleton', undefined, owner)
    this.usedOverrides.add(token)
    return true
  }
}
