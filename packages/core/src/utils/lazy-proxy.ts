const LIFECYCLE_HOOKS = new Set<string | symbol>(['onInit', 'onReady', 'onShutdown', 'onDestroy'])

const lazyProxies = new WeakSet<object>()

/** Whether `value` came from `createLazyProxy()`. Checked without touching the proxy's traps. */
export function isLazyProxy(value: object): boolean {
  return lazyProxies.has(value)
}

/**
 * Returns a proxy that calls `get` on first use and forwards to the result from then on - for a provider factory whose
 * real value only exists after another provider's `onInit()`, like a database handle or a model.
 *
 * Before the first use, `onInit` / `onReady` / `onShutdown` / `onDestroy` read as `undefined`, `constructor` as
 * `Object` (`Function` when constructable) and the prototype as the matching one, without calling `get`, so lifecycle
 * phases do not resolve the proxy. The container probes hooks by reading the property; `in` and `Object.hasOwn()`
 * resolve, so a hook check written that way would resolve the proxy too early.
 *
 * Methods are bound to the resolved value, `constructor` is returned unbound. Writes are not forwarded.
 *
 * @param options.constructable - `new proxy(...)` constructs the resolved value (a mongoose model).
 */
export function createLazyProxy<T extends object>(get: () => T, options?: { constructable?: boolean }): T {
  let cached: T | undefined
  const resolve = (): any => (cached ??= get())
  const constructable = options?.constructable === true

  const handler: ProxyHandler<T> = {
    get(_, prop) {
      if (cached === undefined) {
        if (LIFECYCLE_HOOKS.has(prop)) return undefined
        if (prop === 'constructor') return constructable ? Function : Object
      }
      const target = resolve()
      const value = target[prop]
      if (prop === 'constructor') return value
      return typeof value === 'function' ? value.bind(target) : value
    },
    getPrototypeOf() {
      if (cached === undefined) return constructable ? Function.prototype : Object.prototype
      return Object.getPrototypeOf(cached)
    },
    has(_, prop) {
      return prop in resolve()
    },
    ownKeys() {
      return Reflect.ownKeys(resolve())
    },
    getOwnPropertyDescriptor(_, prop) {
      return Object.getOwnPropertyDescriptor(resolve(), prop)
    },
  }
  if (constructable) {
    handler.construct = (_, args) => new (resolve())(...args)
  }

  // Only a function target can be constructed
  const proxy = new Proxy((constructable ? function () {} : {}) as T, handler)
  lazyProxies.add(proxy)
  return proxy
}
