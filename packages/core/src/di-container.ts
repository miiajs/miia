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
  /**
   * Every module that declares the provider, the first one (its owner) first: what it injects is checked from each.
   * Null for built-ins, `provide()` and guards no module declares.
   */
  owners: ModuleNode[] | null
  /** A guard no module declares, registered for the routes or app.useGuard(). */
  guard: boolean
  /** What such a guard injected while it was constructed, checked from every module that uses it. */
  injected: Set<AnyToken> | null
  /** Requesters (entries, Resolver views) that passed the boundary check after start-up, so it runs once each. */
  seenBy: Set<ContainerEntry | ResolverView> | null
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

/** The module that declares the entry first; null without one. */
function ownerOf(entry: ContainerEntry | undefined): ModuleNode | null {
  return entry?.owners?.[0] ?? null
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
  /** Tokens registered with `app.provide()`: a module may not declare one, the report names them so. @internal */
  readonly provided = new Set<AnyToken>()

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
  /**
   * Requester -> dependency, between singletons, keyed by token: an override replaces the entry, not the token.
   * Recorded until constructAll() fixes the hook order, then cleared.
   */
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
  /** singletonInstances() once every singleton is constructed. */
  private instances: object[] | null = null

  register<T>(
    token: Token<T> | AbstractConstructor<T>,
    factory: ((resolve: Resolve) => T) | (() => T),
    scope: Scope = 'singleton',
    deps?: readonly AnyToken[],
    owner: ModuleNode | null = null,
  ): void {
    const owners = owner ? [owner] : null
    this.registry.set(token, { factory, scope, deps, owners, guard: false, injected: null, seenBy: null })
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
    const entry = this.registry.get(token) ?? this.missing(token, false)!
    return this.instantiate(token, entry, this.stack.at(-1)) as T
  }

  resolveOptional<T>(token: Token<T> | AbstractConstructor<T>): T | null {
    const entry = this.registry.get(token)
    return entry === undefined ? null : (this.instantiate(token, entry, this.stack.at(-1)) as T)
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
    if (this.graph === null || entry.owners === null) return true
    return isModuleList(view) ? view.every((node) => this.sees(node, token)) : this.sees(view, token)
  }

  /**
   * Resolver.resolve() / resolveOptional(): checked from `view`, from each of its modules for a list. A request-scoped
   * token throws even inside a request - Resolver has no request to keep the instance on.
   * @internal
   */
  resolveFrom(view: ResolverView, token: AnyToken, optional: boolean): unknown {
    const entry = this.registry.get(token) ?? this.missing(token, optional)
    if (entry === null) return null
    if (entry.scope === 'request') {
      throw new Error(
        `[Miia] Request-scoped ${formatToken(token)} cannot be resolved through Resolver - ` +
          'use ctx.resolve(), or inject() it in a request-scoped provider',
      )
    }
    if (entry === this.resolverEntry && view !== 'root') return this.resolverOf(view)
    const owner = ownerOf(entry)
    if (this.graph !== null && owner !== null && !entry.seenBy?.has(view)) {
      this.check(view, token, owner, { requester: Resolver, provided: false, via: 'resolve', controller: null })
      this.passed(entry, view)
    }
    return this.instantiate(token, entry, this.stack.at(-1))
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

    const owner = ownerOf(entry)
    if (owner !== null) {
      const via = controller === null ? 'useGuard' : 'uses'
      this.check(consumer, guard, owner, { requester: controller ?? guard, provided: false, via, controller: null })
      return
    }
    for (const token of entry.injected ?? []) {
      const tokenOwner = ownerOf(this.registry.get(token))
      if (tokenOwner === null) continue
      this.check(consumer, token, tokenOwner, { requester: guard, provided: false, via: 'inject', controller })
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
    if (targets === null) return
    queueMicrotask(() => {
      const rest = this.runRequestDestroy(targets, targets.length - 1)
      if (rest === undefined) return
      const chain: Promise<void> = rest
        .catch(() => {})
        .then(() => {
          this.pendingRequestDestroys.delete(chain)
        })
      this.pendingRequestDestroys.add(chain)
    })
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
      const frame: Frame = { token, entry }
      for (const dep of entry.deps) {
        const owner = ownerOf(this.registry.get(dep) ?? this.missing(dep, false, frame, true)!)
        if (this.graph !== null && owner !== null && !entry.guard) this.checkFrame(frame, dep, owner, 'deps')
      }
    }
    for (const [token, entry] of this.registry) {
      if (entry.scope === 'singleton') this.instantiate(token, entry, undefined)
    }
    this.hookOrder = this.lifecycleOrder(true)
    this.edges.clear()
  }

  /** Phase 2 of init: onInit() on every singleton, dependencies first; runs constructAll() if nothing has. */
  async initAll(): Promise<void> {
    if (this.hookOrder === null) this.constructAll()
    await this.runHooks(this.hookOrder!, 'onInit')
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
    await this.runHooks(this.hookOrder ?? this.lifecycleOrder(false), 'onReady')
  }

  /**
   * Constructed singleton instances that are objects, in registration order, each once - whatever the token.
   * Lazy proxies are left out: their target, when registered, is listed itself. Used by DiscoveryService.
   * @internal
   */
  singletonInstances(): readonly object[] {
    if (this.instances !== null) return this.instances
    const result = new Set<object>()
    for (const entry of this.registry.values()) {
      const instance = entry.instance
      if (entry.scope !== 'singleton' || typeof instance !== 'object' || instance === null) continue
      if (!isLazyProxy(instance)) result.add(instance)
    }
    const list = [...result]
    // Fixed once constructAll() has built every singleton.
    if (this.hookOrder !== null) this.instances = list
    return list
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
    await this.runHooks(order, 'onShutdown', failures)
    await this.runHooks(order, 'onDestroy', failures)
    this.registry.clear()
    this.edges.clear()
    this.hookOrder = null
    this.instances = null
    return failures
  }

  /** `hook` on each instance that has it, in order; with `failures` an error is collected and the rest still run. */
  private async runHooks(order: HookTarget[], hook: string, failures?: ShutdownFailure[]): Promise<void> {
    for (const { token, instance } of order) {
      const fn = (instance as Record<string, unknown>)[hook]
      if (typeof fn !== 'function') continue
      if (failures === undefined) {
        await fn.call(instance)
        continue
      }
      try {
        await fn.call(instance)
      } catch (error) {
        failures.push({ source: `${formatToken(token)}.${hook}()`, error })
      }
    }
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

  /**
   * Hooks from `targets[from]` down to the oldest, synchronously until one returns a thenable: the rest wait for it,
   * and the promise of that chain is returned.
   */
  private runRequestDestroy(targets: HookTarget[], from: number): Promise<void> | undefined {
    for (let i = from; i >= 0; i--) {
      const target = targets[i]!
      try {
        const result = (target.instance as { onDestroy: () => unknown }).onDestroy()
        if (isThenable(result)) return this.afterRequestDestroy(result, targets, i)
      } catch (error) {
        this.requestDestroyFailed(target.token, error)
      }
    }
  }

  /** Out of the loop above, which then allocates nothing per hook. */
  private afterRequestDestroy(pending: PromiseLike<unknown>, targets: HookTarget[], at: number): Promise<void> {
    const next = () => this.runRequestDestroy(targets, at - 1)
    return Promise.resolve(pending).then(next, (error) => {
      this.requestDestroyFailed(targets[at]!.token, error)
      return next()
    })
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
    const names = cycle.map((step) => describe(step.token, ownerOf(this.registry.get(step.token))))
    const at = cycle.findIndex((step, i) => i > 0 && step.viaDeps)
    const message = `[Miia] Circular dependency detected: ${names.join(' -> ')}`
    if (at === -1) return message
    return (
      `${message}\n  - deps of ${names[at - 1]} lists ${names[at]}: ` +
      'drop that entry, or move the shared logic into a provider both depend on'
    )
  }

  private recordEdge(token: AnyToken): void {
    if (this.hookOrder !== null) return
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

  /** No entry for `token`: null when `optional`, else the error naming `requester` (or its `deps`). */
  private missing(token: AnyToken, optional: boolean, requester?: Frame, viaDeps = false): null {
    if (optional) return null
    throw new Error(this.noProviderMessage(token, requester ?? this.stack.at(-1), viaDeps))
  }

  private noProviderMessage(token: AnyToken, frame: Frame | undefined, viaDeps: boolean): string {
    const name = formatToken(token)
    const requester = frame && `${viaDeps ? 'deps of ' : ''}${describe(frame.token, ownerOf(frame.entry))}`
    const lines = [`[Miia] No provider found for token: ${name}${requester ? `, required by ${requester}` : ''}`]
    const hint = hintOf(token)
    if (hint) {
      lines.push(`  - ${name} is provided by ${hint}; import that module where ${name} is used`)
      // Equal tokens that are different objects: defined twice on purpose, or two copies of a package.
      if ([...this.registry.keys()].some((key) => key !== token && formatToken(key) === name && hintOf(key) === hint)) {
        lines.push(
          `  - another token named ${name} with the same hint is registered: register this one too if both are ` +
            'intended, otherwise deduplicate the package that defines it',
        )
      }
    }
    return lines.join('\n')
  }

  /** Checks `frame` against module boundaries, then instantiates; S4 is checked from `frame` too. */
  private resolveFor(frame: Frame, token: AnyToken, optional: boolean): unknown {
    const entry = this.registry.get(token) ?? this.missing(token, optional, frame)
    if (entry === null) return null
    // The built-in Resolver comes bound to the module of the requester, or to all of them for an entry several modules
    // declare; one without a module gets the root one.
    const owners = frame.entry.owners
    if (entry === this.resolverEntry && owners !== null) return this.resolverOf(owners.length > 1 ? owners : owners[0]!)
    if (this.graph !== null && entry.owners !== null) {
      if (frame.entry.guard) (frame.entry.injected ??= new Set()).add(token)
      else if (!entry.seenBy?.has(frame.entry)) {
        this.checkFrame(frame, token, entry.owners[0]!, 'inject')
        this.passed(entry, frame.entry)
      }
    }
    return this.instantiate(token, entry, frame)
  }

  private resolverOf(view: ModuleNode | readonly ModuleNode[]): Resolver {
    let resolver = this.resolvers.get(view)
    if (!resolver) this.resolvers.set(view, (resolver = new Resolver(this, view)))
    return resolver
  }

  /**
   * `token` must be visible from every module that declares `frame`, or the root for an entry without one: the
   * result does not depend on which of them the loader reached first.
   */
  private checkFrame(frame: Frame, token: AnyToken, owner: ModuleNode, via: 'inject' | 'deps'): void {
    const owners = frame.entry.owners
    const provided = owners === null && this.provided.has(frame.token)
    this.check(owners ?? 'root', token, owner, { requester: frame.token, provided, via, controller: null })
  }

  /** `token`, declared by `owner`, must be visible from `views`, from each module of a list; a miss is a violation. */
  private check(
    views: ResolverView,
    token: AnyToken,
    owner: ModuleNode,
    base: Omit<BoundaryViolation, 'from' | 'token' | 'owner'>,
  ): void {
    if (isModuleList(views)) {
      for (let i = 0; i < views.length; i++) this.check(views[i]!, token, owner, base)
    } else if (!this.sees(views, token)) {
      this.violate({ ...base, from: views === 'root' ? null : views, token, owner })
    }
  }

  /** A configured module also sees what its host sees. */
  private sees(view: View, token: AnyToken): boolean {
    const graph = this.graph!
    if (view === 'root') return graph.sees(graph.root, token)
    return graph.sees(view, token) || (view.host !== null && graph.sees(view.host, token))
  }

  /** After start-up a violation throws, so a check that returns has passed; the start-up window keeps nothing. */
  private passed(entry: ContainerEntry, requester: ContainerEntry | ResolverView): void {
    if (this.violations === null) (entry.seenBy ??= new Set()).add(requester)
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
        ...this.stack.slice(cycleStart).map((frame) => describe(frame.token, ownerOf(frame.entry))),
        describe(token, ownerOf(entry)),
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

/** A factory that keeps nothing but the class alive, unlike an arrow written inside a method. @internal */
export function classFactory<T>(cls: Constructor<T>): () => T {
  return () => new cls()
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
