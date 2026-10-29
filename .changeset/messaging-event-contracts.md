---
'@miiajs/messaging': minor
'@miiajs/messaging-redis': minor
---

Events are contracts: `defineEvent(topic, schema?)` returns a frozen `{ topic, schema }`, and `MessageBus.publish(event, payload, meta?)` and `@On(event, options?)` take it. The handler's parameter is typed from the schema's output (`EventPayload<typeof E>`, `unknown` without a schema), and `publish()` takes the schema's input (`EventInput<typeof E>`) without running the schema. Each `@On` handler validates the payload before it runs and before an `@Idempotent` claim, and gets the parsed data, as does the idempotency `key()`. A payload that does not match, or a schema that throws, is dead-lettered at once without retry by both the in-memory and the Redis Streams transport (`meta.lastError` is `Payload validation failed for '<topic>': <path>: <message>`, `meta.attempt` is 1), or dropped when the DLQ is off. `dlqEvent(event)` is the schema-less contract of `<topic>.dlq` for dead-letter handlers. A schema describes the JSON form of the payload, which is what a Redis consumer gets: `z.coerce.date()`, not `z.date()`. New exports: `defineEvent`, `dlqEvent` and the types `EventContract`, `EventPayload`, `EventInput`, `OnOptions`. Breaking:

- `publish()` and `@On` no longer take a string topic: `bus.publish(OrderPlaced, order)` and `@On(OrderPlaced)` with `const OrderPlaced = defineEvent('order.placed', schema)` instead of `bus.publish('order.placed', order)` and `@On('order.placed')`; a string throws a `TypeError` that names the fix
- the handler's payload type comes from the event: a parameter of another type does not compile, and a handler of an event without a schema gets `unknown`
- `HandlerResult` has a third status, `{ status: 'reject', error }`, which is never retried and goes straight to the DLQ (or is dropped when `dlq` is off); a custom `MessageTransport` must handle it
