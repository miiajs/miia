// @miiajs/messaging - public API

export { MessageBus } from './message-bus.js'

export { Idempotent, IDEMPOTENT, On, ON } from './decorators.js'
export type { IdempotentMeta, OnMeta } from './decorators.js'

export { IDEMPOTENCY_STORE, MemoryIdempotencyStore, memoryIdempotencyStore } from './idempotency.js'
export type { IdempotencyStore, MemoryIdempotencyStoreOptions } from './idempotency.js'

export { DEFAULT_RETRY, MESSAGE_TRANSPORT } from './types.js'
export type {
  DispatchMode,
  MessageEnvelope,
  MessageMeta,
  MessageTransport,
  HandlerResult,
  RetryConfig,
  SubscribeOptions,
  Subscription,
} from './types.js'

export { dlqTopic, nextBackoffMs } from './retry.js'

export { deriveGroupName } from './group-name.js'
export type { DeriveGroupNameInput } from './group-name.js'

export { InMemoryTransport, inMemoryTransport } from './in-memory-transport.js'
export type { InMemoryTransportOptions } from './in-memory-transport.js'

export { MessagingModule } from './messaging.module.js'
export type { DispatchDefaults, MessagingModuleOptions } from './messaging.module.js'

export { getMessageBusToken, getMessageTransportToken, getIdempotencyStoreToken } from './tokens.js'
