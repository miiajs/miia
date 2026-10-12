import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

const PROCESS_TOKEN = Symbol.for('miia.messaging.processToken')

/** Random per process, kept on `globalThis` so two copies of this package in one process agree on it. */
function processToken(): string {
  const registry = globalThis as unknown as Record<symbol, string | undefined>
  return (registry[PROCESS_TOKEN] ??= randomUUID().slice(0, 8))
}

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
   * `__<hostname>_<pid>_<token>` so every replica gets a unique broker group
   * and the broker delivers a copy of each message to every replica. Mutually
   * exclusive with `explicitGroup`.
   */
  broadcast?: boolean
}

/**
 * Build the broker consumer group name for an `@On` handler.
 *
 * Resolution order:
 * - `explicitGroup` provided → returned as-is (no `appName` prefix, no broadcast suffix)
 * - `broadcast: true` → `${appName ? appName + ':' : ''}${topic}__${ctor}_${method}__${hostname}_${pid}_${token}`
 * - default → `${appName ? appName + ':' : ''}${topic}__${ctor}_${method}`
 *
 * `token` is 8 random hex characters drawn once per process, so replicas that
 * share hostname and pid (host-network containers running as pid 1) still get
 * a group each. The `hostname_pid_token` suffix doubles as the owner id of the
 * Redis transport's liveness key, which the transport reads back off the group
 * name - its owner pattern and this shape change together.
 */
export function deriveGroupName(input: DeriveGroupNameInput): string {
  if (input.explicitGroup) return input.explicitGroup

  const base = input.appName
    ? `${input.appName}:${input.topic}__${input.ctorName}_${input.methodName}`
    : `${input.topic}__${input.ctorName}_${input.methodName}`

  if (input.broadcast) {
    return `${base}__${hostname()}_${process.pid}_${processToken()}`
  }
  return base
}
