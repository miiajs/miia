/**
 * A frozen deep copy of the plain objects and arrays in `value`. Cycles and shared sub-objects are copied once;
 * every other value (`Date`, `Map`, `Set`, class instances, functions) is returned as is. The input is never frozen.
 */
export function deepFrozenCopy<T>(value: T): T {
  return copy(value, new WeakMap()) as T
}

function copy(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value !== 'object' || value === null) {
    return value
  }
  if (seen.has(value)) {
    return seen.get(value)
  }
  if (Array.isArray(value)) {
    const result: unknown[] = new Array(value.length)
    seen.set(value, result)
    for (let i = 0; i < value.length; i++) {
      result[i] = copy(value[i], seen)
    }
    return Object.freeze(result)
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    return value
  }
  const result = Object.create(proto)
  seen.set(value, result)
  for (const key of Object.keys(value)) {
    // defineProperty keeps an own `__proto__` key a key instead of setting the prototype
    Object.defineProperty(result, key, {
      value: copy((value as Record<string, unknown>)[key], seen),
      enumerable: true,
    })
  }
  return Object.freeze(result)
}
