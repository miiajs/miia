import { dlqTopic } from './retry.js'

declare const INPUT: unique symbol

/** Structurally the same as core's `ZodLike`; local so the emitted `contract.d.ts` does not need `@miiajs/core`. */
export interface EventSchema<T = any> {
  safeParse(
    data: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: { path?: PropertyKey[]; message: string }[] } }
}

/** An event: its topic and, optionally, the schema each consumer validates the payload against. */
export interface EventContract<T = unknown, I = T> {
  readonly topic: string
  readonly schema?: EventSchema<T>
  /** Type only, never set: what `publish()` takes. */
  readonly [INPUT]?: I
}

/** What an `@On` handler of the event receives: the schema's output, `unknown` without a schema. */
export type EventPayload<C extends EventContract<any, any>> = C extends EventContract<infer T, any> ? T : never

/** What `MessageBus.publish()` takes for the event: the schema's input, `unknown` without a schema. */
export type EventInput<C extends EventContract<any, any>> = C extends EventContract<any, infer I> ? I : never

type SchemaOutput<S> = S extends EventSchema<infer T> ? T : never

/** Standard Schema input type when the schema declares one (zod 3.24+, zod 4, valibot), else its output. */
type SchemaInput<S> = S extends { readonly '~standard': { readonly types?: infer X } }
  ? NonNullable<X> extends { readonly input: infer I }
    ? I
    : SchemaOutput<S>
  : SchemaOutput<S>

/**
 * Defines an event: the topic it travels on and, optionally, the schema of its payload. `@On(event)` and
 * `MessageBus.publish(event, payload)` take the result, so both ends share one definition and its types: the handler
 * gets the schema's output, `publish()` takes its input. Every consumer validates the payload against the schema
 * before its handler runs; a payload that does not match goes to the DLQ without retry. `publish()` runs no schema.
 *
 * Not memoized: an event is identified by its topic.
 *
 * @example
 * ```ts
 * export const OrderPlaced = defineEvent('order.placed', z.object({ id: z.string(), total: z.number() }))
 * export type OrderPlaced = EventPayload<typeof OrderPlaced>
 *
 * await bus.publish(OrderPlaced, { id: 'o-1', total: 42 })
 *
 * @On(OrderPlaced)
 * async onPlaced(order: OrderPlaced) {}
 * ```
 */
export function defineEvent(topic: string): EventContract<unknown>
export function defineEvent<S extends EventSchema>(
  topic: string,
  schema: S,
): EventContract<SchemaOutput<S>, SchemaInput<S>> & { readonly schema: S }
export function defineEvent(topic: string, schema?: EventSchema): EventContract {
  if (typeof topic !== 'string' || topic === '') {
    throw new TypeError('[messaging] defineEvent() needs a topic')
  }
  if (schema !== undefined && typeof (schema as { safeParse?: unknown } | null)?.safeParse !== 'function') {
    throw new TypeError(`[messaging] defineEvent('${topic}') takes a schema with safeParse() (zod or compatible)`)
  }
  return Object.freeze({ topic, schema })
}

/**
 * The dead-letter event of `event`: topic `<topic>.dlq`, no schema - dead letters include payloads that failed the
 * schema, so a handler of it gets `unknown` and the reason in `meta.lastError`.
 */
export function dlqEvent(event: EventContract<any, any>): EventContract<unknown> {
  assertEventContract(event, 'dlqEvent()')
  return defineEvent(dlqTopic(event.topic))
}

/** @internal */
export function assertEventContract(value: unknown, where: string): asserts value is EventContract {
  if (typeof value === 'string') {
    throw new TypeError(
      `[messaging] ${where} takes an event contract from defineEvent(), got the string '${value}' - ` +
        `define it with defineEvent('${value}', schema)`,
    )
  }
  if (typeof value !== 'object' || value === null || typeof (value as { topic?: unknown }).topic !== 'string') {
    throw new TypeError(`[messaging] ${where} takes an event contract from defineEvent()`)
  }
}
