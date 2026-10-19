import '../polyfill.js'
import type { AbstractConstructor, Scope } from '../types.js'

// ─── Injectable metadata ────────────────────────────────────────

export interface InjectableMeta {
  scope: Scope
  hint?: string
}

// ─── Symbol keys ─────────────────────────────────────────────────

export const INJECTABLE = Symbol('injectable')
export const MODULE = Symbol('module')
export const PREFIX = Symbol('prefix')
export const RESOLVED_PREFIX = Symbol('resolvedPrefix')
export const ROUTES = Symbol('routes')
export const CLASS_MW = Symbol('classMiddlewares')
export const METHOD_MW = Symbol('methodMiddlewares')
export const STATUSES = Symbol('statuses')
export const CLASS_GUARDS = Symbol('classGuards')
export const METHOD_GUARDS = Symbol('methodGuards')
export const SKIP_GUARDS = Symbol('skipGuards')
export const GUARD_FACTORY = Symbol('guardFactory')
export const GUARD_RESPONSES = Symbol('guardResponses')
export const BODY_LIMITS = Symbol('bodyLimits')
export const BODY_SCHEMAS = Symbol('bodySchemas')
export const QUERY_SCHEMAS = Symbol('querySchemas')
export const PARAMS_SCHEMAS = Symbol('paramsSchemas')
export const BODY_READERS = Symbol('bodyReaders')

// ─── Typed helpers ───────────────────────────────────────────────

type Meta = Record<string | symbol, any>

export function getMeta<T>(ctor: AbstractConstructor, key: symbol): T | undefined {
  return (ctor as any)[Symbol.metadata]?.[key] as T | undefined
}

export function setMeta<T>(meta: Meta, key: symbol, value: T): void {
  meta[key] = value
}

// A subclass's metadata inherits its parent's through the prototype chain, so an
// inherited array or Map is copied before the first write instead of mutated.
function ownMap<V>(meta: Meta, key: symbol): Map<string, V> {
  const map = meta[key] as Map<string, V> | undefined
  if (map && Object.hasOwn(meta, key)) return map
  const copy = new Map<string, V>(map ?? [])
  meta[key] = copy
  return copy
}

export function pushMeta<T>(meta: Meta, key: symbol, item: T): void {
  const arr = meta[key] as T[] | undefined
  if (arr && Object.hasOwn(meta, key)) arr.push(item)
  else meta[key] = [...(arr ?? []), item]
}

export function addToMapMeta<T>(meta: Meta, key: symbol, name: string, items: T[]): void {
  const map = ownMap<T[]>(meta, key)
  const existing = map.get(name) ?? []
  map.set(name, [...existing, ...items])
}

export function setInMapMeta<T>(meta: Meta, key: symbol, name: string, value: T): void {
  ownMap<T>(meta, key).set(name, value)
}
