import { classFactory, type Container, REQUEST_CONTEXT, requestContextReplaced } from '../di-container.js'
import { formatPair, formatToken } from '../di-token-format.js'
import { SHARED_PROVIDER } from '../di-token.js'
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
import { isOverride, OVERRIDE_CHECK, OVERRIDE_KIND } from './overrides.js'
import type { CheckedOverride, OverrideDescriptor } from './overrides.js'
import { FORWARD_REF, isForwardRef } from './forward-ref.js'
import { ModuleGraph } from './module-graph.js'
import type { ModuleNode } from './module-graph.js'
import { joinPaths } from '../utils/index.js'

/**
 * The first declaration of a token: from `@Module({ providers })` of a class (`static`), from a configure() result,
 * or the instance of a module class itself.
 */
interface Declaration {
  node: ModuleNode
  kind: 'static' | 'configured' | 'module'
  /** The `shared` key of the provider. */
  key: string | undefined
}

/** The node that mounts the controllers of a module class, and the other names of the class: they own them too. */
interface MountedControllers {
  node: ModuleNode
  prefix: string
  owners: ModuleNode[]
}

type ModuleItem = Constructor | ConfiguredModule

function isConfiguredModule(value: unknown): value is ConfiguredModule {
  return typeof value === 'object' && value !== null && typeof (value as ConfiguredModule).module === 'function'
}

function sharedKeyOf(provider: ProviderDefinition): string | undefined {
  return typeof provider === 'function' ? undefined : (provider as { [SHARED_PROVIDER]?: string })[SHARED_PROVIDER]
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`
}

export class ModuleLoader {
  private logger = new Logger(ModuleLoader.name)
  private moduleGraph = new ModuleGraph()
  /** By the pair (class, name); a bare class is the pair (class, ''). */
  private nodes = new Map<Constructor, Map<string, ModuleNode>>()
  private declared = new Map<AnyToken, Declaration>()
  /** By module class, in the order phase 2 mounts them: once, whatever the number of names. */
  private mountedControllers = new Map<Constructor, MountedControllers>()
  private forwardRefs = new WeakMap<ForwardRef<ModuleItem>, ModuleItem>()
  private providerOverrides = new Map<AnyToken, CheckedOverride & { factory: () => unknown }>()
  private usedOverrides = new Set<AnyToken>()
  private routesResolver: RoutesResolver

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
    const moduleOverrides: (CheckedOverride & { module: ConfiguredModule })[] = []
    items.forEach((item, index) => {
      if (!isOverride(item)) modules.push(this.unwrap(item, root, 'imports', index) as ModuleItem)
      else if (item[OVERRIDE_KIND] === 'module') moduleOverrides.push(item)
      else if (item.token === REQUEST_CONTEXT) throw requestContextReplaced('override')
      else this.providerOverrides.set(item.token, item)
    })

    for (const mod of modules) {
      this.addImport(root, this.collect(mod, root))
    }

    for (const descriptor of moduleOverrides) {
      const replacement = descriptor.module
      const node = this.nodeOf(replacement)
      // Until processModule() adds `@Module({ global })`, `global` is that of the configuration: an override inherits it.
      descriptor[OVERRIDE_CHECK]?.(node?.config ? node.global : null)
      if (node?.config) node.config = replacement
    }

    // Tokens already in the container (built-ins, provide()) never pass through registerProvider(),
    // and phase 2 constructs controllers and guards - replace them before anything is built.
    for (const token of this.providerOverrides.keys()) {
      if (this.container.has(token)) this.applyOverride(token, null)
    }

    // Phase 1: Load modules, register providers
    for (const node of root.imports) {
      this.processModule(node)
    }
    // The graph outlives the loader: drop the configurations it no longer needs.
    for (const byName of this.nodes.values()) {
      for (const node of byName.values()) node.config = null
    }

    // From here on the container checks module boundaries: phase 2 constructs controllers and guards.
    this.container.graph = this.moduleGraph

    // Phase 2: Resolve routes
    for (const { node, prefix, owners } of this.mountedControllers.values()) {
      for (const controller of getMeta<ModuleOptions>(node.module!, MODULE)!.controllers!) {
        // Registered only if absent: an override or provide() is there first.
        if (!this.container.has(controller)) {
          this.container.register(controller, classFactory(controller), 'singleton', undefined, node)
        }
        // The other names must own the entry before the controller is constructed.
        for (const owner of owners) this.own(owner, controller)
        const fullPrefix = joinPaths(prefix, getMeta<string>(controller, PREFIX) ?? '')
        this.routesResolver.resolve(controller, fullPrefix, node, owners)
        // Expose the fully-resolved prefix as class metadata so DiscoveryService
        // consumers (e.g. @miiajs/swagger) can pair controllers with their live
        // routing prefix without reaching into ModuleLoader internals.
        const classMeta = (controller as { [Symbol.metadata]?: Record<string | symbol, unknown> })[Symbol.metadata]
        if (classMeta) setMeta(classMeta, RESOLVED_PREFIX, fullPrefix)
      }
    }

    for (const [token, descriptor] of this.providerOverrides) {
      descriptor[OVERRIDE_CHECK]?.(this.usedOverrides.has(token))
    }
  }

  /**
   * Builds the node of every pair (class, name) with its imports and, for a configured module, its host,
   * before phase 1. Every configuration is recorded here, so a bare import resolves to it whatever the
   * order, a second configuration of a pair throws, and so does one configure() result under two hosts.
   */
  private collect(item: ModuleItem, host: ModuleNode): ModuleNode {
    if (isOverride(item)) throw new Error('[Miia] override descriptors are only allowed at the top level of register()')

    const moduleCtor = typeof item === 'function' ? item : item.module
    const name = typeof item === 'function' ? '' : (item.name ?? '')
    let byName = this.nodes.get(moduleCtor)
    if (!byName) this.nodes.set(moduleCtor, (byName = new Map()))
    let node = byName.get(name)
    const created = !node
    if (!node) byName.set(name, (node = this.moduleGraph.createNode(formatPair(moduleCtor, name), moduleCtor, name)))

    if (typeof item !== 'function') {
      if (node.config) {
        if (node.config !== item) {
          const cls = formatToken(moduleCtor)
          throw new Error(
            `[Miia] ${node.label} is configured twice (${node.host!.importer}, ${host.importer}) - configure it once; ` +
              'a module that takes a name can be configured again under a different one; ' +
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
        node.config = item
        node.global = item.global === true
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

  private processModule(node: ModuleNode, parentPrefix = ''): void {
    if (node.processed) return
    node.processed = true

    const moduleCtor = node.module!
    const config = node.config
    const meta = getMeta<ModuleOptions>(moduleCtor, MODULE)
    const prefix = joinPaths(parentPrefix, meta?.prefix ?? '')

    // The collected (possibly overridden) configuration; a bare class gets the unnamed one, if any.
    for (const provider of config?.providers ?? []) {
      this.registerProvider(provider, node, 'configured')
    }

    for (const imported of node.imports) {
      this.processModule(imported, prefix)
    }

    for (const provider of meta?.providers ?? []) {
      this.registerProvider(provider, node, 'static')
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
        // Controllers are registered in phase 2, only if absent - an override has to be there first.
        if (!mounted) this.applyOverride(controller, node)
      }
    }

    if (this.declared.get(moduleCtor)?.kind === 'module') {
      // Another name of the class: one module instance, owned by every name.
      this.own(node, moduleCtor)
    } else if (!this.container.has(moduleCtor)) {
      this.container.register(moduleCtor, classFactory(moduleCtor), 'singleton', undefined, node)
      node.owns.add(moduleCtor)
      this.declared.set(moduleCtor, { node, kind: 'module', key: undefined })
    }

    // `exports` and `global` from `@Module` of the class and the configuration, once the node owns all it declares.
    node.global ||= meta?.global === true
    node.hasExports = meta?.exports !== undefined || config?.exports !== undefined
    meta?.exports?.forEach((ref, index) => this.addExport(node, ref, index))
    config?.exports?.forEach((ref, index) => this.addExport(node, ref, index))

    this.logger.log(`${node.label} dependencies initialized`)
  }

  /** An export is an owned token or a module the node imports, matched by its pair (class, name). */
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

  private registerProvider(provider: ProviderDefinition, node: ModuleNode, kind: Declaration['kind']): void {
    const token = typeof provider === 'function' ? provider : (provider as FactoryProvider).token
    const key = sharedKeyOf(provider)
    const first = this.declared.get(token)
    // A module class instance is no provider declaration: one declared again keeps it, like a built-in.
    if (first && first.kind !== 'module') {
      if (first.node === node) throw new Error(this.duplicateMessage(token, first.node, node))
      // Another name of the class: one instance, owned by every name.
      const sameClass = first.node.module === node.module
      if (kind === 'static' && first.kind === 'static' && sameClass) return this.own(node, token)
      if (key !== undefined && first.key !== undefined) {
        if (key !== first.key) {
          throw new Error(
            `[Miia] ${formatToken(token)} is shared by ${first.node.where} (${first.key}) and ${node.where} (${key}) - ` +
              'a shared provider must be declared the same way in every module; use a separate token for each variant',
          )
        }
        // Another module declaring a shared provider: one instance, owned by both.
        return this.own(node, token)
      }
      throw new Error(this.duplicateMessage(token, first.node, node))
    }
    if (this.container.provided.has(token)) {
      const name = formatToken(token)
      throw new Error(
        `[Miia] provide(${name}): ${name} is declared by ${node.where} - replace it with override() instead`,
      )
    }
    if (token === REQUEST_CONTEXT) {
      throw new Error(
        `[Miia] ${node.where} declares REQUEST_CONTEXT in providers - it is built in and seeded by every request, ` +
          'so it takes no provider; remove it from providers',
      )
    }
    // Any other built-in token declared by a module keeps the built-in.
    if (this.container.has(token)) return

    // An overridden provider still has its declaration: a second module declaring it is a duplicate, or joins it.
    this.declared.set(token, { node, kind, key })
    node.owns.add(token)
    if (this.applyOverride(token, node)) return
    if (typeof provider === 'function') {
      const scope = getMeta<InjectableMeta>(provider, INJECTABLE)?.scope ?? 'singleton'
      this.container.register(provider, classFactory(provider), scope, undefined, node)
    } else {
      const fp = provider as FactoryProvider
      this.container.register(fp.token, fp.factory, fp.scope, fp.deps, node)
    }
  }

  /** One more module that declares `token`: it owns the same entry. */
  private own(node: ModuleNode, token: AnyToken): void {
    node.owns.add(token)
    this.container.addOwner(token, node)
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
    const descriptor = this.providerOverrides.get(token)
    if (!descriptor) return false
    // The replacement is a value or its own factory; the deps of the provider it replaces do not apply to it.
    this.container.register(token, descriptor.factory, 'singleton', undefined, owner)
    this.usedOverrides.add(token)
    return true
  }
}
