import { hostname } from 'node:os'

export interface DeriveGroupNameInput {
  topic: string
  ctorName: string
  methodName: string
  appName: string | null
  /**
   * Explicit user-provided group from `@On({ group: '...' })`. When set,
   * returned as-is - explicit groups are full-qualified by the user and do
   * NOT receive `appName` prefix.
   */
  explicitGroup?: string
  /**
   * Cluster-wide fan-out opt-in. When `true`, the group is suffixed with
   * `__<hostname>_<pid>` so every replica gets a unique broker group and
   * the broker delivers a copy of each message to every replica. Mutually
   * exclusive with `explicitGroup`.
   */
  broadcast?: boolean
}

/**
 * Build the broker consumer group name for an `@On` handler.
 *
 * Resolution order:
 * - `explicitGroup` provided → returned as-is (no `appName` prefix, no broadcast suffix)
 * - `broadcast: true` → `${appName ? appName + ':' : ''}${topic}__${ctor}_${method}__${hostname}_${pid}`
 * - default → `${appName ? appName + ':' : ''}${topic}__${ctor}_${method}`
 *
 * The `hostname_pid` suffix doubles as the owner id the Redis transport's orphan
 * cleanup looks up as a liveness key, so its shape and that key change together.
 * Replicas that share both hostname and pid share one group: copies are split
 * between them, and the first to shut down destroys it for the other.
 */
export function deriveGroupName(input: DeriveGroupNameInput): string {
  if (input.explicitGroup) return input.explicitGroup

  const base = input.appName
    ? `${input.appName}:${input.topic}__${input.ctorName}_${input.methodName}`
    : `${input.topic}__${input.ctorName}_${input.methodName}`

  if (input.broadcast) {
    return `${base}__${hostname()}_${process.pid}`
  }
  return base
}
