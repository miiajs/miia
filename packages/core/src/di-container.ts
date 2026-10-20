import { getMeta, INJECTABLE } from './decorators/metadata.js'
import type { InjectableMeta } from './decorators/metadata.js'
import { formatToken } from './di-token-format.js'
import { createToken } from './di-token.js'
import { Logger } from './logger.js'
import type { AbstractConstructor, AnyToken, Constructor, RequestContext, Resolve, Scope, Token } from './types.js'
import { isLazyProxy } from './utils/index.js'
import { Resolver } from './resolver.js'
import { boundaryReport, describe, startupReport, withViolations } from './app/boundary-report.js'
import type { BoundaryViolation } from './app/boundary-report.js'
import type { ModuleGraph, ModuleNode } from './app/module-graph.js'

/** Where a check looks from: a module, or the root for what has none. */
export type View = ModuleNode | 'root'
/** What a Resolver looks from: a view, or every module that declares the entry it was injected into. */
export type ResolverView = View | readonly ModuleNode[]

interface ContainerEntry {
  factory: ((resolve: Resolve) => unknown) | (() => unknown)
  scope: Scope
  instance?: unknown
  deps?: readonly AnyToken[]
  /** The module that declares the provider; null for built-ins, `provide()` and guards no module declares. */
  owner: ModuleNode | null
  /** Every module that declares the provider, `owner` first: what it injects is checked from each; null without one. */
  owners: ModuleNode[] | null
  /** A guard no module declares, registered for the routes or app.useGuard(). */
  guard: boolean
  /** What such a guard injected while it was constructed, checked from every module that uses it. */
  injected: Set<AnyToken> | null
}

interface HookTarget {
  token: AnyToken
  instance: object
}

/** An entry being constructed, or the entry a factory's `resolve` is bound to. */
interface Frame {
  token: AnyToken
  entry: ContainerEntry
}

/** A shutdown step that threw: `source` names it (`X.onDestroy()`, `closeServer()`). */
export interface ShutdownFailure {
  source: string
  error: unknown
}

function hintOf(token: AnyToken): string | undefined {
  return typeof token === 'function' ? getMeta<InjectableMeta>(token, INJECTABLE)?.hint : token.hint
}

/** The context of the current request: inject() it in a request-scoped provider, or resolve() it in its factory. */
export const REQUEST_CONTEXT: Token<RequestContext> = createToken<RequestContext>('RequestContext')

/** provide() / override() of REQUEST_CONTEXT: every request seeds its own. @internal */
export function requestContextReplaced(call: 'provide' | 'override'): Error {
  return new Error(
    `[Miia] ${call}(${formatToken(REQUEST_CONTEXT)}): REQUEST_CONTEXT is built in and seeded by every request - ` +
      'it cannot be provided or overridden; test a request-scoped provider through a route with TestApp.request(), ' +
      'or override that provider itself',
  )
}

/** The scope of a request whose pipeline has finished. @internal */
export const CLOSED = Symbol('closed')

/** What ctx.resolve() hands over: the scope is created on the first request-scoped resolve. @internal */
export interface RequestScopeHolder {
  _scope: Map<AnyToken, unknown> | typeof CLOSED | null
}

function isModuleList(view: ResolverView): view is readonly ModuleNode[] {
  return Array.isArray(view)
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

const OUTSIDE_CONTEXT =
  '[Miia] inject() called outside of container context. ' +
  'Ensure inject() is used inside a class field initializer or factory function within the DI system.'

export class Container {
  /** @internal */
  static activeContainer: Container | null = null

  /**
   * Set by the module loader once every module is registered: from then on what an entry injects, resolves
   * and lists in `deps` is checked against module boundaries. Null in a container without modules.
   * @internal
   */
  graph: ModuleGraph | null = null
  /** Tokens registered with `app.provide()`, named so in the report. @internal */
  provided: ReadonlySet<AnyToken> = new Set()

  private registry = new Map<AnyToken, ContainerEntry>()
  private requestScope: RequestScopeHolder | null = null
  /** Every constructed singleton: a request does not own one its factory returns. */
  private singletons = new WeakSet<object>()
  private requestLogger = new Logger('RequestScope')
  /** The async onDestroy() chains of finished requests, one per request; destroyAll() waits for them. */
  private pendingRequestDestroys = new Set<Promise<void>>()
  private stack: Frame[] = []
  /** Violations of the start-up window; null outside it, where a violation throws at once. */
  private violations: BoundaryViolation[] | null = null
  /** Requester -> dependency, between singletons, keyed by token: an override replaces the entry, not the token. */
  private edges = new Map<AnyToken, Set<AnyToken>>()
  private hookOrder: HookTarget[] | null = null
  /**
   * The built-in Resolver, bound to the root; while it is registered, inject(Resolver) gets one for its module, or
   * for every module of an entry several declare.
   */
  private resolverEntry: ContainerEntry | null = null
  /** By module, or by the live `owners` of an entry several modules declare. */
  private resolvers = new WeakMap<ModuleNode | readonly ModuleNode[], Resolver>()
  /** Guard -> the modules it is already checked from. */
  private checkedGuards = new Map<AnyToken, Set<View>>()

  register<T>(
    token: Token<T> | AbstractConstructor<T>,
    factory: ((resolve: Resolve) => T) | (() => T),
    scope: Scope = 'singleton',
    deps?: readonly AnyToken[],
    owner: ModuleNode | null = null,
  ): void {
    const owners = owner ? [owner] : null
    this.registry.set(token, { factory, scope, deps, owner, owners, guard: false, injected: null })
  }

  /**
   * One more module that declares `token`, e.g. another name of a module class: it owns the same entry, and what
   * the entry injects is checked from it too.
   * @internal
   */
  addOwner(token: AnyToken, node: ModuleNode): void {
    const owners = this.registry.get(token)?.owners
    if (owners && !owners.includes(node)) owners.push(node)
  }

  registerClass<T>(cls: Constructor<T>, scope: Scope = 'singleton'): void {
    this.register(cls, () => new cls(), scope)
  }

  /**
   * A guard no module declares, registered for the routes or app.useGuard(): what it injects is recorded
   * instead of checked, and checkGuard() checks it from every module that uses the guard.
   * @internal
   */
  registerGuard(cls: Constructor): void {
    this.registerClass(cls)
    this.registry.get(cls)!.guard = true
  }

  /**
   * The built-in Resolver, bound to the root: app.get(Resolver) and requesters without a module get it.
   * @internal
   */
  registerResolver(): void {
    this.register(Resolver, () => new Resolver(this, 'root'))
    this.resolverEntry = this.registry.get(Resolver)!
  }

  /** Top-level resolution (app.get(), ctx.resolve(), the framework itself): not checked against boundaries. */
  resolve<T>(token: Token<T> | AbstractConstructor<T>): T {
    const entry = this.registry.get(token)
    if (!entry) throw new Error(this.noProviderMessage(token))
    return this.instantiate(token, entry, this.stack.at(-1)) as T
  }

  resolveOptional<T>(token: Token<T> | AbstractConstructor<T>): T | null {
    const entry = this.registry.get(token)
    if (!entry) return null
    return this.instantiate(token, entry, this.stack.at(-1)) as T
  }

  /**
   * inject() / injectOptional(): checked from the entry being constructed.
   * @internal
   */
  resolveFromStack(token: AnyToken, optional: boolean): unknown {
    const frame = this.stack.at(-1)
    if (!frame) throw new Error(OUTSIDE_CONTEXT)
    return this.resolveFor(frame, token, optional)
  }

  /**
   * Resolver.has(): registered and visible from `view` - from each of its modules for a list.
   * @internal
   */
  visible(view: ResolverView, token: AnyToken): boolean {
    const entry = this.registry.get(token)
    if (!entry) return false
    if (this.graph === null || entry.owner === null) return true
    return isModuleList(view) ? view.every((node) => this.sees(node, token)) : this.sees(view, token)
  }

  /**
   * Resolver.resolve() / resolveOptional(): checked from `view`, from each of its modules for a list. A request-scoped
   * token throws even inside a request - Resolver has no request to keep the instance on.
   * @internal
   */
  resolveFrom(view: ResolverView, token: AnyToken, optional: boolean): unknown {
    const entry = this.registry.get(token)
    if (!entry) {
      if (optional) return null
      throw new Error(this.noProviderMessage(token))
    }
    if (entry.scope === 'request') {
      throw new Error(
        `[Miia] Request-scoped ${formatToken(token)} cannot be resolved through Resolver - ` +
          'use ctx.resolve(), or inject() it in a request-scoped provider',
      )
    }
    if (entry === this.resolverEntry && view !== 'root') return this.resolverOf(view)
    const owner = entry.owner
    if (this.graph !== null && owner !== null) {
      if (isModuleList(view)) {
        for (let i = 0; i < view.length; i++) this.checkResolve(view[i]!, token, owner)
      } else {
        this.checkResolve(view, token, owner)
      }
    }
    return this.instantiate(token, entry, this.stack.at(-1))
  }

  /** A Resolver of `view` resolving `token`, declared by `owner`. */
  private checkResolve(view: View, token: AnyToken, owner: ModuleNode): void {
    if (this.sees(view, token)) return
    const from = view === 'root' ? null : view
    this.violate({ requester: Resolver, from, provided: false, token, owner, via: 'resolve', controller: null })
  }

  /**
   * A guard checked from the module of `controller`, which uses it, or from the root for app.useGuard(); once per
   * pair. A guard a module declares must be visible from there; what a guard no module declares injected is checked
   * from there. A guard registered with app.provide() is visible to every module.
   * @internal
   */
  checkGuard(guard: AnyToken, consumer: View, controller: AnyToken | null = null): void {
    const entry = this.registry.get(guard)
    if (this.graph === null || !entry) return
    let consumers = this.checkedGuards.get(guard)
    if (!consumers) this.checkedGuards.set(guard, (consumers = new Set()))
    if (consumers.has(consumer)) return
    consumers.add(consumer)

    const from = consumer === 'root' ? null : consumer
    if (entry.owner !== null) {
      if (this.sees(consumer, guard)) return
      const requester = controller ?? guard
      const via = controller === null ? 'useGuard' : 'uses'
      this.violate({ requester, from, provided: false, token: guard, owner: entry.owner, via, controller: null })
      return
    }
    for (const token of entry.injected ?? []) {
      const owner = this.registry.get(token)?.owner
      if (!owner || this.sees(consumer, token)) continue
      this.violate({ requester: guard, from, provided: false, token, owner, via: 'inject', controller })
    }
  }

  /**
   * Runs `fn` as the start-up window: a boundary violation is collected instead of thrown, and resolution
   * goes on to find the rest. At the end the violations make one report, or are appended to the error that
   * escapes; both carry BOUNDARY_REPORT. A nested call joins the outer window.
   * @internal
   */
  collect<T>(fn: () => T): T {
    if (this.violations !== null) return fn()
    const violations: BoundaryViolation[] = []
    this.violations = violations
    let result: T
    try {
      result = fn()
    } catch (error) {
      if (violations.length === 0) throw error
      throw withViolations(error, violations, this.graph!)
    } finally {
      this.violations = null
    }
    if (violations.length > 0) throw startupReport(violations, this.graph!)
    return result
  }

  /** @internal */
  resolveInRequest<T>(token: Token<T> | AbstractConstructor<T>, holder: RequestScopeHolder): T {
    const prev = this.requestScope
    this.requestScope = holder
    try {
      return this.resolve<T>(token)
    } finally {
      this.requestScope = prev
    }
  }

  /**
   * The end of a request: onDestroy() on the instances it owns, newest first, in a microtask after the caller has
   * returned. Not the context itself, a singleton a request factory returned, or a lazy proxy. Nothing to destroy,
   * nothing scheduled. destroyAll() waits for the hooks of requests that finished before it started.
   * @internal
   */
  destroyRequestScope(scope: Map<AnyToken, unknown>, ctx: object): void {
    let targets: HookTarget[] | null = null
    for (const [token, instance] of scope) {
      if (instance === ctx || instance === null || (typeof instance !== 'object' && typeof instance !== 'function')) {
        continue
      }
      if (this.singletons.has(instance) || isLazyProxy(instance)) continue
      if (typeof (instance as { onDestroy?: unknown }).onDestroy !== 'function') continue
      if (targets === null) targets = []
      else if (targets.some((target) => target.instance === instance)) continue
      targets.push({ token, instance })
    }
    if (targets !== null) queueMicrotask(() => this.runRequestDestroy(targets, targets.length - 1))
  }

  has(token: AnyToken): boolean {
    return this.registry.has(token)
  }

  /**
   * Every singleton is constructed: set by constructAll(), cleared at the end of destroyAll().
   * @internal
   */
  get allConstructed(): boolean {
    return this.hookOrder !== null
  }

  /** Phase 1 of init: checks `deps`, instantiates every singleton (runs all factories) and fixes the hook order. */
  constructAll(): void {
    for (const [token, entry] of this.registry) {
      if (entry.deps === undefined) continue
      for (const dep of entry.deps) {
        const depEntry = this.registry.get(dep)
        if (!depEntry) throw new Error(this.noProviderMessage(dep, `deps of ${describe(token, entry.owner)}`))
        if (this.graph !== null && depEntry.owner !== null && !entry.guard) {
          this.checkVisible({ token, entry }, dep, depEntry.owner, 'deps')
        }
      }
    }
    for (const [token, entry] of this.registry) {
      if (entry.scope === 'singleton') this.instantiate(token, entry, undefined)
    }
    this.hookOrder = this.lifecycleOrder(true)
  }

  /** Phase 2 of init: onInit() on every singleton, dependencies first; runs constructAll() if nothing has. */
  async initAll(): Promise<void> {
    if (this.hookOrder === null) this.constructAll()
    for (const { instance } of this.hookOrder!) {
      const onInit = (instance as { onInit?: () => unknown }).onInit
      if (typeof onInit === 'function') {
        await onInit.call(instance)
      }
    }
  }

  /**
   * Phase 3 of init: invoke onReady() on all singletons that define it.
   * Called by Miia.doInit() after initAll() and compilePipelines().
   *
   * Guarantees:
   * - By the time any onReady() runs, all onInit() hooks have completed.
   * - Same order as onInit(): a provider's hook runs after the hooks of the singletons it
   *   resolved while being constructed or lists in `deps`; otherwise registration order.
   * - An instance registered under several tokens gets the hook once.
   */
  async bootstrapAll(): Promise<void> {
    for (const { instance } of this.hookOrder ?? this.lifecycleOrder(false)) {
      const onReady = (instance as { onReady?: () => unknown }).onReady
      if (typeof onReady === 'function') {
        await onReady.call(instance)
      }
    }
  }

  /**
   * Constructed singleton instances that are objects, in registration order, each once - whatever the token.
   * Lazy proxies are left out: their target, when registered, is listed itself. Used by DiscoveryService.
   * @internal
   */
  singletonInstances(): object[] {
    const result = new Set<object>()
    for (const entry of this.registry.values()) {
      const instance = entry.instance
      if (entry.scope !== 'singleton' || typeof instance !== 'object' || instance === null) continue
      if (!isLazyProxy(instance)) result.add(instance)
    }
    return [...result]
  }

  /**
   * Shutdown: first the onDestroy() hooks of requests that have already finished, then onShutdown() on every
   * singleton, then onDestroy() on every singleton, both in reverse dependency order. A hook that throws does
   * not stop the rest - its error is returned, not thrown.
   * Without constructAll() (only app.get(), or a failed init()) the order comes from what was built so far.
   */
  async destroyAll(): Promise<ShutdownFailure[]> {
    await this.settleRequestScopes()
    const order = (this.hookOrder ?? this.lifecycleOrder(false)).toReversed()
    const failures: ShutdownFailure[] = []
    for (const hook of ['onShutdown', 'onDestroy'] as const) {
      for (const { token, instance } of order) {
        const fn = (instance as Record<string, unknown>)[hook]
        if (typeof fn !== 'function') continue
        try {
          await fn.call(instance)
        } catch (error) {
          failures.push({ source: `${formatToken(token)}.${hook}()`, error })
        }
      }
    }
    this.registry.clear()
    this.edges.clear()
    this.hookOrder = null
    return failures
  }

  /**
   * The onDestroy() chains of requests that finished before shutdown started. The microtask of a request that ended
   * in this tick runs before the continuation of `await null` and registers its chain; one that ends later is not
   * waited for, so requests that keep coming in (app.fetch without a server to close) cannot hold shutdown.
   */
  private async settleRequestScopes(): Promise<void> {
    await null
    if (this.pendingRequestDestroys.size > 0) await Promise.all([...this.pendingRequestDestroys])
  }

  /** Hooks from `targets[from]` down to the oldest; after a hook that returns a thenable the rest wait for it. */
  private runRequestDestroy(targets: HookTarget[], from: number): void {
    for (let i = from; i >= 0; i--) {
      const target = targets[i]!
      try {
        const result = (target.instance as { onDestroy: () => unknown }).onDestroy()
        if (isThenable(result)) {
          const chain: Promise<void> = this.awaitRequestDestroy(result, targets, i)
            .catch(() => {})
            .then(() => {
              this.pendingRequestDestroys.delete(chain)
            })
          this.pendingRequestDestroys.add(chain)
          return
        }
      } catch (error) {
        this.requestDestroyFailed(target.token, error)
      }
    }
  }

  /** The rest of the hooks of a request after `targets[at]` returned a thenable: one chain, which never rejects. */
  private async awaitRequestDestroy(pending: PromiseLike<unknown>, targets: HookTarget[], at: number): Promise<void> {
    try {
      await pending
    } catch (error) {
      this.requestDestroyFailed(targets[at]!.token, error)
    }
    for (let i = at - 1; i >= 0; i--) {
      const target = targets[i]!
      try {
        const result = (target.instance as { onDestroy: () => unknown }).onDestroy()
        if (isThenable(result)) await result
      } catch (error) {
        this.requestDestroyFailed(target.token, error)
      }
    }
  }

  /** A logger that throws must not escape the microtask. */
  private requestDestroyFailed(token: AnyToken, error: unknown): void {
    try {
      this.requestLogger.error(
        `${formatToken(token)}.onDestroy() failed at the end of a request`,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      )
    } catch {}
  }

  /**
   * Singletons with an instance, each after the singletons it depends on (construction edges and `deps`),
   * otherwise in registration order; one entry per instance. `strict` turns a cycle into an error.
   */
  private lifecycleOrder(strict: boolean): HookTarget[] {
    const order: HookTarget[] = []
    const added = new Set<object>()
    const visited = new Set<AnyToken>()
    const path: Array<{ token: AnyToken; viaDeps: boolean }> = []

    const visit = (token: AnyToken, entry: ContainerEntry, viaDeps: boolean): void => {
      if (visited.has(token)) return
      const cycleStart = path.findIndex((step) => step.token === token)
      if (cycleStart !== -1) {
        if (strict) throw new Error(this.hookCycleMessage([...path.slice(cycleStart), { token, viaDeps }]))
        return
      }
      path.push({ token, viaDeps })
      for (const dep of entry.deps ?? []) visitNeighbour(dep, true)
      for (const dep of this.edges.get(token) ?? []) visitNeighbour(dep, false)
      path.pop()
      visited.add(token)
      const instance = entry.instance
      if (instance === null || (typeof instance !== 'object' && typeof instance !== 'function')) return
      if (added.has(instance)) return
      added.add(instance)
      order.push({ token, instance })
    }
    const visitNeighbour = (token: AnyToken, viaDeps: boolean): void => {
      const entry = this.registry.get(token)
      if (entry?.scope === 'singleton') visit(token, entry, viaDeps)
    }

    for (const [token, entry] of this.registry) {
      if (entry.scope === 'singleton' && entry.instance !== undefined) visit(token, entry, false)
    }
    return order
  }

  /** `cycle` starts and ends with the same token; `viaDeps` tells how each step was reached from the previous one. */
  private hookCycleMessage(cycle: Array<{ token: AnyToken; viaDeps: boolean }>): string {
    const names = cycle.map((step) => describe(step.token, this.registry.get(step.token)?.owner ?? null))
    const lines = [`[Miia] Circular dependency detected: ${names.join(' -> ')}`]
    const at = cycle.findIndex((step, i) => i > 0 && step.viaDeps)
    if (at !== -1) {
      const from = names[at - 1]
      // Two providers: the step back is the other edge of the pair
      const injects = cycle.length === 3 && !cycle[3 - at]!.viaDeps
      lines.push(
        `  - deps of ${from} lists ${names[at]}, which ${injects ? 'injects' : 'depends on'} ${from}: ` +
          'drop the deps entry, or move the shared logic into a separate provider both depend on',
      )
    }
    return lines.join('\n')
  }

  private recordEdge(token: AnyToken): void {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i]!
      if (frame.entry.scope !== 'singleton') continue
      if (frame.token === token) return
      let deps = this.edges.get(frame.token)
      if (!deps) this.edges.set(frame.token, (deps = new Set()))
      deps.add(token)
      return
    }
  }

  private noProviderMessage(token: AnyToken, requiredBy?: string): string {
    const name = formatToken(token)
    const top = this.stack.at(-1)
    const requester = requiredBy ?? (top ? describe(top.token, top.entry.owner) : undefined)
    const lines = [`[Miia] No provider found for token: ${name}${requester ? `, required by ${requester}` : ''}`]
    const hint = hintOf(token)
    if (hint) {
      lines.push(`  - ${name} is provided by ${hint}; import that module where ${name} is used`)
      // Equal tokens that are different objects: defined twice on purpose, or two copies of a package.
      const copy = [...this.registry.keys()].some(
        (key) => key !== token && formatToken(key) === name && hintOf(key) === hint,
      )
      if (copy) {
        lines.push(
          `  - another token named ${name} with the same hint is registered: if ${name} is defined twice on purpose ` +
            '(e.g. one model per connection), register this one too; otherwise two copies of the package ' +
            'that defines it are probably installed - deduplicate the dependency',
        )
      }
    }
    return lines.join('\n')
  }

  /** Checks `frame` against module boundaries, then instantiates; S4 is checked from `frame` too. */
  private resolveFor(frame: Frame, token: AnyToken, optional: boolean): unknown {
    const entry = this.registry.get(token)
    if (!entry) {
      if (optional) return null
      throw new Error(this.noProviderMessage(token, describe(frame.token, frame.entry.owner)))
    }
    // The built-in Resolver comes bound to the module of the requester, or to all of them for an entry several modules
    // declare; one without a module gets the root one.
    const owners = frame.entry.owners
    if (entry === this.resolverEntry && owners !== null) return this.resolverOf(owners.length > 1 ? owners : owners[0]!)
    if (this.graph !== null && entry.owner !== null) {
      if (frame.entry.guard) (frame.entry.injected ??= new Set()).add(token)
      else this.checkVisible(frame, token, entry.owner, 'inject')
    }
    return this.instantiate(token, entry, frame)
  }

  private resolverOf(view: ModuleNode | readonly ModuleNode[]): Resolver {
    let resolver = this.resolvers.get(view)
    if (!resolver) this.resolvers.set(view, (resolver = new Resolver(this, view)))
    return resolver
  }

  /**
   * `token`, declared by `owner`, must be visible from every module that declares `frame`, or the root for an
   * entry without one: the result does not depend on which of them the loader reached first.
   */
  private checkVisible(frame: Frame, token: AnyToken, owner: ModuleNode, via: 'inject' | 'deps'): void {
    const owners = frame.entry.owners
    if (owners === null) {
      if (this.sees('root', token)) return
      const provided = this.provided.has(frame.token)
      this.violate({ requester: frame.token, from: null, provided, token, owner, via, controller: null })
      return
    }
    for (let i = 0; i < owners.length; i++) {
      const from = owners[i]!
      if (this.sees(from, token)) continue
      this.violate({ requester: frame.token, from, provided: false, token, owner, via, controller: null })
    }
  }

  /** A configured module also sees what its host sees. */
  private sees(view: View, token: AnyToken): boolean {
    const graph = this.graph!
    if (view === 'root') return graph.sees(graph.root, token)
    return graph.sees(view, token) || (view.host !== null && graph.sees(view.host, token))
  }

  /** Collected in the start-up window, thrown outside it. */
  private violate(violation: BoundaryViolation): void {
    if (this.violations === null) throw boundaryReport([violation], this.graph!)
    this.violations.push(violation)
  }

  /** `requester` is who asks for `token`: S4 is checked from it. */
  private instantiate(token: AnyToken, entry: ContainerEntry, requester: Frame | undefined): unknown {
    if (entry.scope === 'singleton' && entry.instance !== undefined) {
      if (this.stack.length > 0) this.recordEdge(token)
      return entry.instance
    }

    const cycleStart = this.stack.findIndex((frame) => frame.token === token)
    if (cycleStart !== -1) {
      const chain = [
        ...this.stack.slice(cycleStart).map((frame) => describe(frame.token, frame.entry.owner)),
        describe(token, entry.owner),
      ]
      throw new Error(
        `[Miia] Circular dependency detected: ${chain.join(' -> ')}\n` +
          '  - move the shared logic into a separate provider both can inject\n' +
          '  - or decouple with events (@miiajs/messaging)\n' +
          '  - or, if the cycle is intended, resolve one side lazily through Resolver in a getter',
      )
    }

    if (entry.scope === 'singleton') {
      const instance = this.callFactory(token, entry)
      entry.instance = instance
      if ((typeof instance === 'object' && instance !== null) || typeof instance === 'function') {
        this.singletons.add(instance)
      }
      if (this.stack.length > 0) this.recordEdge(token)
      return instance
    }

    if (entry.scope === 'request') {
      if (requester && requester.entry.scope !== 'request') {
        const name = formatToken(requester.token)
        throw new Error(
          `[Miia] ${name} (${requester.entry.scope}) injects request-scoped ${formatToken(token)} - ` +
            `resolve it with ctx.resolve() in the handler, or make ${name} request-scoped`,
        )
      }
      const holder = this.requestScope
      if (holder === null) {
        throw new Error(
          `[Miia] Request-scoped ${formatToken(token)} can only be resolved inside a request (ctx.resolve)`,
        )
      }
      let scope = holder._scope
      if (scope === CLOSED) {
        throw new Error(
          `[Miia] Request-scoped ${formatToken(token)} was resolved after its request finished ` +
            '(e.g. from a streaming response) - resolve it in the handler before returning',
        )
      }
      if (scope === null) scope = holder._scope = new Map<AnyToken, unknown>().set(REQUEST_CONTEXT, holder)
      const cached = scope.get(token)
      if (cached !== undefined) return cached
      const instance = this.callFactory(token, entry)
      scope.set(token, instance)
      return instance
    }

    // transient - always new
    return this.callFactory(token, entry)
  }

  private callFactory(token: AnyToken, entry: ContainerEntry): unknown {
    const prev = Container.activeContainer
    Container.activeContainer = this
    const frame: Frame = { token, entry }
    this.stack.push(frame)
    try {
      const fn = entry.factory
      if (fn.length === 0) return (fn as () => unknown)()
      // Bound to this entry for life: a late call, e.g. from a lazy proxy, is checked from it, not from the stack.
      const resolve: Resolve = <X>(t: Token<X> | AbstractConstructor<X>) => this.resolveFor(frame, t, false) as X
      return (fn as (r: Resolve) => unknown)(resolve)
    } finally {
      this.stack.pop()
      Container.activeContainer = prev
    }
  }
}

// ─── inject / injectOptional ─────────────────────────────────────

function getActiveContainer(): Container {
  if (!Container.activeContainer) throw new Error(OUTSIDE_CONTEXT)
  return Container.activeContainer
}

export function inject<T>(token: Token<T> | AbstractConstructor<T>): T {
  return getActiveContainer().resolveFromStack(token, false) as T
}

/** `null` for a token nothing registers; a registered token the requester's module cannot see is a violation. */
export function injectOptional<T>(token: Token<T> | AbstractConstructor<T>): T | null {
  return getActiveContainer().resolveFromStack(token, true) as T | null
}
