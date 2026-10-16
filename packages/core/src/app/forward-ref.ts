import type { ConfiguredModule, Constructor, ForwardRef } from '../types.js'

export const FORWARD_REF = Symbol('forwardRef')

/**
 * A module reference the loader resolves when it processes the graph. Two module files that import
 * each other wrap the import in `forwardRef(() => X)` on both sides, in `imports` and `exports`.
 */
export function forwardRef<T extends Constructor | ConfiguredModule>(fn: () => T): ForwardRef<T> {
  return { [FORWARD_REF]: fn }
}

export function isForwardRef(value: unknown): value is ForwardRef<Constructor | ConfiguredModule> {
  return typeof value === 'object' && value !== null && FORWARD_REF in value
}
