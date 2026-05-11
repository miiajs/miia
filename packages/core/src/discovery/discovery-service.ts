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

/**
 * Public facade over Container for ambient discovery of singleton instances
 * and their method-level metadata. Auto-registered by Miia in its constructor.
 *
 * Use inside `onReady()` (not `onInit()`) to guarantee all providers have
 * finished their own initialization before scanning.
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

  /** All singleton instances currently in the container (providers + controllers + guards). */
  getSingletons(): Array<{ ctor: Constructor; instance: object }> {
    return this.container.getSingletonInstances()
  }

  /**
   * Scans every singleton for the given metadata key. The metadata under
   * `key` must be an array of objects each containing `handlerName: string`.
   *
   * Returns one entry per discovered method, ready for binding.
   */
  getMethodsWithMeta<T extends DiscoverableMethodMeta>(key: symbol): DiscoveredMethod<T>[] {
    const result: DiscoveredMethod<T>[] = []
    for (const { ctor, instance } of this.container.getSingletonInstances()) {
      const items = getMeta<T[]>(ctor, key)
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
}
