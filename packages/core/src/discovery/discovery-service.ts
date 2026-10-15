import { getMeta } from '../decorators/metadata.js'
import type { Container } from '../di-container.js'
import type { Constructor } from '../types.js'

/**
 * Base shape that discoverable method-decorator metadata must satisfy.
 * Decorators should push items like `{ handlerName: ctx.name as string, ...userData }`
 * into metadata so that DiscoveryService can bind them back to their method.
 */
export interface DiscoverableMethodMeta {
  handlerName: string
}

export interface DiscoveredMethod<T extends DiscoverableMethodMeta> {
  instance: object
  ctor: Constructor
  methodName: string
  metadata: T
}

export interface DiscoveredClass<M = unknown> {
  instance: object
  ctor: Constructor
  metadata: M
}

/**
 * Public facade over Container for ambient discovery, bounded by a metadata key: only singletons whose class
 * carries metadata under `key` are returned. `getClassesWithMeta()` is for class decorators, `getMethodsWithMeta()`
 * for method decorators. Auto-registered by Miia in its constructor.
 *
 * Metadata is read from the class of each instance, so a factory provider is discovered by the class of what it
 * returns, and a plain-object mock (no class of its own) is not discovered at all. Results are per instance: one
 * class provided twice is listed twice. Lazy proxies are skipped - their target is listed when it is registered.
 *
 * Call from `onReady()` (or `onInit()`): both methods throw until every provider is constructed.
 *
 * @example
 * ```ts
 * const ON = Symbol('on')
 * export const On = createMethodDecorator<[event: string]>((_target, ctx, event) => {
 *   pushMeta(ctx.metadata!, ON, { event, handlerName: ctx.name as string })
 * })
 *
 * @Injectable()
 * class EventBus {
 *   private discovery = inject(DiscoveryService)
 *   private handlers = new Map<string, Function[]>()
 *
 *   async onReady() {
 *     for (const { instance, methodName, metadata } of
 *          this.discovery.getMethodsWithMeta<{ event: string; handlerName: string }>(ON)) {
 *       const list = this.handlers.get(metadata.event) ?? []
 *       list.push((instance as any)[methodName].bind(instance))
 *       this.handlers.set(metadata.event, list)
 *     }
 *   }
 * }
 * ```
 */
export class DiscoveryService {
  constructor(private readonly container: Container) {}

  /** One entry per singleton whose class has metadata under `key`. */
  getClassesWithMeta<M>(key: symbol): DiscoveredClass<M>[] {
    this.assertConstructed('getClassesWithMeta')
    const result: DiscoveredClass<M>[] = []
    for (const { instance, ctor } of this.instances()) {
      const metadata = getMeta<M>(ctor, key)
      if (metadata === undefined) continue
      result.push({ instance, ctor, metadata })
    }
    return result
  }

  /**
   * Scans every singleton for the given metadata key. The metadata under
   * `key` must be an array of objects each containing `handlerName: string`.
   *
   * Returns one entry per discovered method, ready for binding.
   */
  getMethodsWithMeta<M extends DiscoverableMethodMeta>(key: symbol): DiscoveredMethod<M>[] {
    this.assertConstructed('getMethodsWithMeta')
    const result: DiscoveredMethod<M>[] = []
    for (const { instance, ctor } of this.instances()) {
      const items = getMeta<M[]>(ctor, key)
      if (!items || items.length === 0) continue
      for (const metadata of items) {
        result.push({
          instance,
          ctor,
          methodName: metadata.handlerName,
          metadata,
        })
      }
    }
    return result
  }

  private *instances(): Generator<{ instance: object; ctor: Constructor }> {
    for (const instance of this.container.singletonInstances()) {
      // Not instance.constructor: that would go through the get trap of a registered Proxy
      const ctor: unknown = Object.getPrototypeOf(instance)?.constructor
      if (typeof ctor === 'function') yield { instance, ctor: ctor as Constructor }
    }
  }

  private assertConstructed(method: string): void {
    if (!this.container.allConstructed) {
      throw new Error(
        `[Miia] DiscoveryService.${method}() was called before every provider was constructed - ` +
          'call it from onReady() (or onInit())',
      )
    }
  }
}
