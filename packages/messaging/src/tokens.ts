import type { Token } from '@miiajs/core'
import { createToken } from '@miiajs/core'
import type { IdempotencyStore } from './idempotency.js'
import { MessageBus } from './message-bus.js'
import type { MessageTransport } from './types.js'

// An empty name is the default bus, as in MessagingModule.configure()
function memoByName<T>(create: (name: string | undefined) => Token<T>): (name?: string) => Token<T> {
  const cache = new Map<string, Token<T>>()
  return (name) => {
    const key = name || ''
    let token = cache.get(key)
    if (!token) {
      token = create(name || undefined)
      cache.set(key, token)
    }
    return token
  }
}

/** The `configure()` call that registers the bus `name`, for hints and errors. */
export function configureCall(name?: string): string {
  return name ? `MessagingModule.configure(opts, { name: '${name}' })` : 'MessagingModule.configure(opts)'
}

const namedBus = memoByName((name) => createToken<MessageBus>(`MessageBus(${name})`, { hint: configureCall(name) }))

/**
 * DI token for a named bus registered by `MessagingModule.configure(opts, { name })`.
 * Returns the same token for the same name. The default bus is the `MessageBus` class itself.
 *
 * @example
 * ```ts
 * private kafka = inject(messageBus('kafka'))
 * ```
 */
export function messageBus(name: string): Token<MessageBus> {
  if (!name) {
    throw new TypeError('[messaging] messageBus() needs a bus name - inject the default bus with inject(MessageBus)')
  }
  return namedBus(name)
}

// ─── Internal token helpers (not exported from package index) ─────────────

export const transportToken: (name?: string) => Token<MessageTransport> = memoByName((name) =>
  createToken<MessageTransport>(`MessageTransport(${name ?? 'default'})`),
)

export const idempotencyStoreToken: (name?: string) => Token<IdempotencyStore | null> = memoByName((name) =>
  createToken<IdempotencyStore | null>(`IdempotencyStore(${name ?? 'default'})`),
)

export function busToken(name?: string): Token<MessageBus> | typeof MessageBus {
  return name ? messageBus(name) : MessageBus
}
