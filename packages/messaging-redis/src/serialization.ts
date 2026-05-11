import type { MessageEnvelope } from '@miiajs/messaging'

/**
 * XREADGROUP returns each entry as a flat `[field, value, field, value, ...]`
 * array. We store the whole envelope under a single `data` field as JSON,
 * so parsing is just: find `data`, parse the next element.
 */
export function parseEnvelopeFromFields(fields: string[]): MessageEnvelope {
  const dataIdx = fields.indexOf('data')
  if (dataIdx === -1 || !fields[dataIdx + 1]) {
    throw new Error('[messaging-redis] Stream entry missing "data" field')
  }
  return JSON.parse(fields[dataIdx + 1]!) as MessageEnvelope
}
