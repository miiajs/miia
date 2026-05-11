import type { Constructor } from '@miiajs/core'
import { MessageBus } from './message-bus.js'
import { IDEMPOTENCY_STORE } from './idempotency.js'
import { MESSAGE_TRANSPORT } from './types.js'

/**
 * DI token for the message transport of a (default or named) bus.
 * Returns the default `MESSAGE_TRANSPORT` constant when called without name.
 */
export function getMessageTransportToken(name?: string): string {
  return name ? `miia:messaging:transport:${name}` : MESSAGE_TRANSPORT
}

/**
 * DI token for the optional idempotency store of a (default or named) bus.
 * Returns the default `IDEMPOTENCY_STORE` constant when called without name.
 */
export function getIdempotencyStoreToken(name?: string): string {
  return name ? `miia:messaging:idempotency-store:${name}` : IDEMPOTENCY_STORE
}

/**
 * DI token for the MessageBus instance of a (default or named) bus.
 * - default: returns the `MessageBus` class itself, so `inject(MessageBus)` works.
 * - named: returns a string token; use `inject<MessageBus>(getMessageBusToken('kafka'))`.
 */
export function getMessageBusToken(name?: string): string | Constructor<MessageBus> {
  return name ? `miia:messaging:bus:${name}` : MessageBus
}
