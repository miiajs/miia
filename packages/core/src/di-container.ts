import { getMeta, INJECTABLE } from './decorators/metadata.js'
import type { InjectableMeta } from './decorators/metadata.js'
import { formatToken } from './di-token-format.js'
import type { AbstractConstructor, AnyToken, Constructor, Resolve, Scope, Token } from './types.js'
import { isLazyProxy } from './utils/index.js'
import { boundaryReport, describe, startupReport, withViolations } from './app/boundary-report.js'
import type { BoundaryViolation } from './app/boundary-report.js'
import type { ModuleGraph, ModuleNode } from './app/module-graph.js'

interface ContainerEntry {
  factory: ((resolve: Resolve) => unknown) | (() => unknown)
  scope: Scope
  instance?: unknown
  deps?: readonly AnyToken[]
  /** The module that declares the provider; null for built-ins, `provide()` and guards no module declares. */
  owner: ModuleNode | null
  /** A guard no module declares, built for the routes that use it. */
  guard: boolean
  /** What such a guard injected while it was constructed. */
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
  private requestScope: Map<AnyToken, unknown> | null = null
  private stack: Frame[] = []
  /** Violations of the start-up window; null outside it, where a violation throws at once. */
  private violations: BoundaryViolation[] | null = null
  /** Requester -> dependency, between singletons, keyed by token: an override replaces the entry, not the token. */
  private edges = new Map<AnyToken, Set<AnyToken>>()
  private hookOrder: HookTarget[] | null = null

  register<T>(
    token: Token<T> | AbstractConstructor<T>,
    factory: ((resolve: Resolve) => T) | (() => T),
    scope: Scope = 'singleton',
    deps?: readonly AnyToken[],
    owner: ModuleNode | null = null,
  ): void {
    this.registry.set(token, { factory, scope, deps, owner, guard: false, injected: null })
  }

  registerClass<T>(cls: Constructor<T>, scope: Scope = 'singleton'): void {
    this.register(cls, () => new cls(), scope)
  }

  /**
   * A guard no module declares, registered for the routes that use it: what it injects is not checked.
   * @internal
   */
  registerGuard(cls: Constructor): void {
    this.registerClass(cls)
    this.registry.get(cls)!.guard = true
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
  resolveInRequest<T>(token: Token<T> | AbstractConstructor<T>, scope: Map<AnyToken, unknown>): T {
    const prev = this.requestScope
    this.requestScope = scope
    try {
      return this.resolve<T>(token)
    } finally {
      this.requestScope = prev
    }
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
   * Shutdown: onShutdown() on every singleton, then onDestroy() on every singleton, both in reverse
   * dependency order. A hook that throws does not stop the rest - its error is returned, not thrown.
   * Without constructAll() (only app.get(), or a failed init()) the order comes from what was built so far.
   */
  async destroyAll(): Promise<ShutdownFailure[]> {
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
    if (this.graph !== null && entry.owner !== null && !frame.entry.guard) {
      this.checkVisible(frame, token, entry.owner, 'inject')
    }
    return this.instantiate(token, entry, frame)
  }

  /**
   * `token`, declared by `owner`, must be visible from the module of `frame`: the root for an entry without one,
   * plus the host for a configured module. Collected in the start-up window, thrown outside it.
   */
  private checkVisible(frame: Frame, token: AnyToken, owner: ModuleNode, via: 'inject' | 'deps'): void {
    const graph = this.graph!
    const from = frame.entry.owner
    const visible =
      from === null
        ? graph.sees(graph.root, token)
        : graph.sees(from, token) || (from.host !== null && graph.sees(from.host, token))
    if (visible) return
    const provided = this.provided.has(frame.token)
    const violation: BoundaryViolation = { requester: frame.token, from, provided, token, owner, via }
    if (this.violations === null) throw boundaryReport([violation], graph)
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
      const scope = this.requestScope
      if (scope === null) {
        throw new Error(
          `[Miia] Request-scoped ${formatToken(token)} can only be resolved inside a request (ctx.resolve)`,
        )
      }
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
