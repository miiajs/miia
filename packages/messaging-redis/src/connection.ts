import { DEFAULT_SOCKET_TIMEOUT_MS, MAX_TIMER_MS } from './constants.js'

/**
 * The text of a connection error for a log line. A refused `localhost` arrives as an `AggregateError` with an empty
 * message, one nested error per address tried, so it is told by its code and the nested messages instead.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const code = (err as { code?: unknown }).code
  const head = err.message || (typeof code === 'string' ? code : err.name)
  if (!(err instanceof AggregateError) || err.errors.length === 0) return head
  const nested = err.errors.map((e) => (e instanceof Error ? e.message : String(e)))
  return `${head}: ${nested.join('; ')}`
}

/**
 * Validate a `socketTimeoutMs` - `0` disables it. ioredis hands it, plus `blockMs` on a lane, to `setTimeout`, which
 * fires at once on anything it cannot hold and so would drop every command: those throw at construction instead.
 */
export function resolveSocketTimeout(value: number | undefined, blockMs = 0): number {
  const ms = value ?? DEFAULT_SOCKET_TIMEOUT_MS
  if (!Number.isInteger(ms) || ms < 0 || blockMs + ms > MAX_TIMER_MS) {
    const limit = blockMs > 0 ? `and blockMs + socketTimeoutMs at most ${MAX_TIMER_MS}` : `at most ${MAX_TIMER_MS}`
    const got = blockMs > 0 ? `${ms} with blockMs ${blockMs}` : String(ms)
    throw new Error(`[messaging-redis] socketTimeoutMs must be an integer >= 0, ${limit} - got ${got}`)
  }
  return ms
}
