// @miiajs/messaging - public API

export { MessageBus } from './message-bus.js'

export { defineEvent, dlqEvent } from './contract.js'
export type { EventContract, EventInput, EventPayload } from './contract.js'

export { Idempotent, IDEMPOTENT, On, ON } from './decorators.js'
export type { IdempotentMeta, OnMeta, OnOptions } from './decorators.js'

export { MemoryIdempotencyStore, memoryIdempotencyStore } from './idempotency.js'
export type { IdempotencyStore, MemoryIdempotencyStoreOptions } from './idempotency.js'

export { DEFAULT_RETRY } from './types.js'
export type {
  DispatchMode,
  MessageEnvelope,
  MessageMeta,
  MessageTransport,
  HandlerResult,
  InitialPosition,
  InitialPositionKind,
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

export { messageBus } from './tokens.js'
