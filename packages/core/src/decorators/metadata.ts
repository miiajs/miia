import '../polyfill.js'
import type { Constructor, Scope } from '../types.js'

// ─── Injectable metadata ────────────────────────────────────────

export interface InjectableMeta {
  scope: Scope
  token?: string
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
export const BODY_LIMITS = Symbol('bodyLimits')
export const BODY_SCHEMAS = Symbol('bodySchemas')
export const QUERY_SCHEMAS = Symbol('querySchemas')
export const PARAMS_SCHEMAS = Symbol('paramsSchemas')

// ─── Typed helpers ───────────────────────────────────────────────

type Meta = Record<string | symbol, any>

export function getMeta<T>(ctor: Constructor, key: symbol): T | undefined {
  return (ctor as any)[Symbol.metadata]?.[key] as T | undefined
}

export function setMeta<T>(meta: Meta, key: symbol, value: T): void {
  meta[key] = value
}

export function pushMeta<T>(meta: Meta, key: symbol, item: T): void {
  const arr = (meta[key] as T[]) ?? []
  arr.push(item)
  meta[key] = arr
}

export function addToMapMeta<T>(meta: Meta, key: symbol, name: string, items: T[]): void {
  const map = (meta[key] as Map<string, T[]>) ?? new Map<string, T[]>()
  const existing = map.get(name) ?? []
  map.set(name, [...existing, ...items])
  meta[key] = map
}

export function setInMapMeta<T>(meta: Meta, key: symbol, name: string, value: T): void {
  const map = (meta[key] as Map<string, T>) ?? new Map<string, T>()
  map.set(name, value)
  meta[key] = map
}
