---
'@miiajs/messaging': minor
---

A named bus is injected through the typed token `messageBus(name)`, and a named `MessagingModule.configure()` is the same module class with a `name`. "No provider" errors name the call that provides a bus: `MessageBus(kafka) is provided by MessagingModule.configure(opts, { name: 'kafka' })`. Configuring one bus name twice now throws `configured twice`, and a named bus can be replaced in tests with `TestApp.override(MessagingModule, MessagingModule.configure(test, { name: 'kafka' }))`. Breaking:

- `MESSAGE_TRANSPORT`, `IDEMPOTENCY_STORE`, `getMessageBusToken()`, `getMessageTransportToken()` and `getIdempotencyStoreToken()` are no longer exported; the transport and idempotency store tokens are internal
- a named bus is `inject(messageBus('kafka'))` instead of `inject<MessageBus>(getMessageBusToken('kafka') as string)`; the default bus stays `inject(MessageBus)`
- the bus name moved into an options object: `MessagingModule.configure(opts, { name: 'kafka' })` instead of `MessagingModule.configure(opts, 'kafka')`, and a named `configure()` returns `{ module: MessagingModule, name }` instead of a new anonymous module class per call
