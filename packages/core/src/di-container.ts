import { getMeta, INJECTABLE } from './decorators/metadata.js'
import type { InjectableMeta } from './decorators/metadata.js'
import { formatToken } from './di-token-format.js'
import type { AbstractConstructor, AnyToken, Constructor, Resolve, Scope, Token } from './types.js'

interface ContainerEntry {
  factory: ((resolve: Resolve) => unknown) | (() => unknown)
  scope: Scope
  instance?: unknown
}

function hintOf(token: AnyToken): string | undefined {
  return typeof token === 'function' ? getMeta<InjectableMeta>(token, INJECTABLE)?.hint : token.hint
}

export class Container {
  /** @internal */
  static activeContainer: Container | null = null

  private registry = new Map<AnyToken, ContainerEntry>()
  private requestScope: Map<AnyToken, unknown> | null = null
  private stack: Array<{ token: AnyToken; entry: ContainerEntry }> = []

  register<T>(
    token: Token<T> | AbstractConstructor<T>,
    factory: ((resolve: Resolve) => T) | (() => T),
    scope: Scope = 'singleton',
  ): void {
    this.registry.set(token, { factory, scope })
  }

  registerClass<T>(cls: Constructor<T>, scope: Scope = 'singleton'): void {
    this.registry.set(cls, {
      factory: () => new cls(),
      scope,
    })
  }

  resolve<T>(token: Token<T> | AbstractConstructor<T>): T {
    const entry = this.registry.get(token)
    if (!entry) throw new Error(this.noProviderMessage(token))
    return this.instantiate(token, entry) as T
  }

  resolveOptional<T>(token: Token<T> | AbstractConstructor<T>): T | null {
    const entry = this.registry.get(token)
    if (!entry) return null
    return this.instantiate(token, entry) as T
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

  async initAll(): Promise<void> {
    // Phase 1: instantiate all singletons (runs all factories)
    const singletons: unknown[] = []
    for (const [token, entry] of this.registry) {
      if (entry.scope === 'singleton') {
        singletons.push(this.instantiate(token, entry))
      }
    }
    // Phase 2: lifecycle hooks
    for (const instance of singletons) {
      const onInit = (instance as { onInit?: () => unknown } | null)?.onInit
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
   *
   * Caveats:
   * - Order of onReady() calls is registration order (same as initAll()).
   *   Avoid inter-onReady dependencies - if provider A's onReady() relies on
   *   provider B's onReady() having run first, the result is order-fragile.
   * - Lazy-registered providers (e.g. global guards added via app.useGuard()
   *   after initAll() - see compilePipelines() in app.ts) will receive
   *   onReady() but may not have received onInit(). This mirrors the existing
   *   pre-existing quirk with onDestroy() and is not introduced by this change.
   */
  async bootstrapAll(): Promise<void> {
    for (const [, entry] of this.registry) {
      if (entry.scope === 'singleton' && entry.instance) {
        const onReady = (entry.instance as { onReady?: () => unknown }).onReady
        if (typeof onReady === 'function') {
          await onReady.call(entry.instance)
        }
      }
    }
  }

  /**
   * Returns all singleton instances currently registered in the container.
   * Filters out token-object registrations (only class-keyed entries) and
   * entries that have not yet been instantiated.
   *
   * Used by DiscoveryService for ambient method-decorator discovery.
   */
  getSingletonInstances(): Array<{ ctor: Constructor; instance: object }> {
    const result: Array<{ ctor: Constructor; instance: object }> = []
    for (const [token, entry] of this.registry) {
      if (
        entry.scope === 'singleton' &&
        typeof entry.instance === 'object' &&
        entry.instance !== null &&
        typeof token === 'function'
      ) {
        result.push({ ctor: token as Constructor, instance: entry.instance })
      }
    }
    return result
  }

  async destroyAll(): Promise<void> {
    for (const [, entry] of this.registry) {
      if (entry.scope === 'singleton' && entry.instance) {
        const onDestroy = (entry.instance as { onDestroy?: () => unknown }).onDestroy
        if (typeof onDestroy === 'function') {
          await onDestroy.call(entry.instance)
        }
      }
    }
    this.registry.clear()
  }

  private noProviderMessage(token: AnyToken): string {
    const name = formatToken(token)
    const requester = this.stack.at(-1)
    const requiredBy = requester ? `, required by ${formatToken(requester.token)}` : ''
    const lines = [`[Miia] No provider found for token: ${name}${requiredBy}`]
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

  private instantiate(token: AnyToken, entry: ContainerEntry): unknown {
    if (entry.scope === 'singleton' && entry.instance !== undefined) return entry.instance

    const cycleStart = this.stack.findIndex((frame) => frame.token === token)
    if (cycleStart !== -1) {
      const chain = [...this.stack.slice(cycleStart).map((frame) => formatToken(frame.token)), formatToken(token)]
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
      return instance
    }

    if (entry.scope === 'request') {
      const requester = this.stack.at(-1)
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
    this.stack.push({ token, entry })
    try {
      const fn = entry.factory
      if (fn.length === 0) return (fn as () => unknown)()
      const resolve: Resolve = <X>(t: Token<X> | AbstractConstructor<X>) => this.resolve<X>(t)
      return (fn as (r: Resolve) => unknown)(resolve)
    } finally {
      this.stack.pop()
      Container.activeContainer = prev
    }
  }
}

// ─── inject / injectOptional ─────────────────────────────────────

function getActiveContainer(): Container {
  if (!Container.activeContainer) {
    throw new Error(
      '[Miia] inject() called outside of container context. ' +
        'Ensure inject() is used inside a class field initializer or factory function within the DI system.',
    )
  }
  return Container.activeContainer
}

export function inject<T>(token: Token<T> | AbstractConstructor<T>): T {
  return getActiveContainer().resolve<T>(token)
}

export function injectOptional<T>(token: Token<T> | AbstractConstructor<T>): T | null {
  return getActiveContainer().resolveOptional<T>(token)
}
