import type { Constructor, Resolve, Scope } from './types.js'

interface ContainerEntry {
  factory: ((resolve: Resolve) => unknown) | (() => unknown)
  scope: Scope
  instance?: unknown
}

export class Container {
  /** @internal */
  static activeContainer: Container | null = null

  private registry = new Map<string | Constructor, ContainerEntry>()
  private requestInstances = new Map<string | Constructor, unknown>()
  private resolving = new Set<string | Constructor>()

  register<T>(
    token: Constructor<T> | string,
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

  resolve<T>(token: Constructor<T> | string): T {
    const entry = this.registry.get(token)
    if (!entry) {
      throw new Error(`[Miia] No provider found for token: ${String(token)}`)
    }
    return this.instantiate(token, entry) as T
  }

  resolveOptional<T>(token: Constructor<T> | string): T | null {
    const entry = this.registry.get(token)
    if (!entry) return null
    return this.instantiate(token, entry) as T
  }

  has(token: Constructor | string): boolean {
    return this.registry.has(token)
  }

  clearRequestScope(): void {
    if (this.requestInstances.size > 0) this.requestInstances.clear()
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
   * Filters out string-token registrations (only class-keyed entries) and
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
    this.requestInstances.clear()
  }

  private instantiate(token: string | Constructor, entry: ContainerEntry): unknown {
    if (entry.scope === 'singleton' && entry.instance !== undefined) return entry.instance

    if (this.resolving.has(token)) {
      throw new Error(`[Miia] Circular dependency detected: ${String(token)}`)
    }
    this.resolving.add(token)
    try {
      if (entry.scope === 'singleton') {
        const instance = this.callFactory(entry)
        entry.instance = instance
        return instance
      }

      if (entry.scope === 'request') {
        const cached = this.requestInstances.get(token)
        if (cached !== undefined) return cached
        const instance = this.callFactory(entry)
        this.requestInstances.set(token, instance)
        return instance
      }

      // transient - always new
      return this.callFactory(entry)
    } finally {
      this.resolving.delete(token)
    }
  }

  private callFactory(entry: ContainerEntry): unknown {
    const prev = Container.activeContainer
    Container.activeContainer = this
    try {
      const fn = entry.factory
      if (fn.length === 0) return (fn as () => unknown)()
      const resolve: Resolve = <X>(t: Constructor<X> | string) => this.resolve<X>(t)
      return (fn as (r: Resolve) => unknown)(resolve)
    } finally {
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

export function inject<T>(token: Constructor<T>): T
export function inject<T>(token: string): T
export function inject<T>(token: Constructor<T> | string): T {
  return getActiveContainer().resolve<T>(token)
}

export function injectOptional<T>(token: Constructor<T>): T | null
export function injectOptional<T>(token: string): T | null
export function injectOptional<T>(token: Constructor<T> | string): T | null {
  return getActiveContainer().resolveOptional<T>(token)
}
// ─── runInContainerContext ───────────────────────────────────────

export function runInContainerContext<T>(container: Container, fn: () => T): T {
  const prev = Container.activeContainer
  Container.activeContainer = container
  try {
    return fn()
  } finally {
    Container.activeContainer = prev
  }
}
