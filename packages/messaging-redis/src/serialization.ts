import type { MessageEnvelope } from '@miiajs/messaging'

/**
 * XREADGROUP returns each entry as a flat `[field, value, field, value, ...]`
 * array. We store the whole envelope under a single `data` field as JSON,
 * so parsing is just: find `data`, parse the next element, check its shape.
 */
export function parseEnvelopeFromFields(fields: string[]): MessageEnvelope {
  const dataIdx = fields.indexOf('data')
  if (dataIdx === -1 || !fields[dataIdx + 1]) {
    throw new Error('[messaging-redis] Stream entry missing "data" field')
  }
  const parsed: unknown = JSON.parse(fields[dataIdx + 1]!)
  if (!isEnvelope(parsed)) {
    throw new Error('[messaging-redis] Stream entry "data" is not a message envelope')
  }
  return parsed
}

/** Only what the transport and the bus dereference: `id` keys idempotency, `meta` is read on every delivery. */
function isEnvelope(value: unknown): value is MessageEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const { id, meta } = value as { id?: unknown; meta?: unknown }
  return typeof id === 'string' && typeof meta === 'object' && meta !== null
}
