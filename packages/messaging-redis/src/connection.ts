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
