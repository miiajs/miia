import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { defineEvent, dlqEvent, type EventInput, type EventPayload } from '../src/contract.js'
import { On } from '../src/decorators.js'
import type { MessageBus } from '../src/message-bus.js'
import type { MessageMeta } from '../src/types.js'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const Order = z.object({ id: z.string(), total: z.number() })
const OrderPlaced = defineEvent('order.placed', Order)
type OrderPlaced = EventPayload<typeof OrderPlaced>

const Ping = defineEvent('ops.ping')

describe('defineEvent', () => {
  it('returns a frozen { topic, schema }', () => {
    expect(OrderPlaced).toEqual({ topic: 'order.placed', schema: Order })
    expect(OrderPlaced.schema).toBe(Order)
    expect(Object.isFrozen(OrderPlaced)).toBe(true)
  })

  it('leaves schema undefined without one', () => {
    expect(Ping.topic).toBe('ops.ping')
    expect(Ping.schema).toBeUndefined()
    expect(Object.isFrozen(Ping)).toBe(true)
  })

  it('throws TypeError on an empty or non-string topic', () => {
    expect(() => defineEvent('')).toThrow(new TypeError('[messaging] defineEvent() needs a topic'))
    expect(() => defineEvent(42 as unknown as string)).toThrow(new TypeError('[messaging] defineEvent() needs a topic'))
  })

  it('throws TypeError on a schema without safeParse()', () => {
    const message = "[messaging] defineEvent('order.placed') takes a schema with safeParse() (zod or compatible)"
    expect(() => defineEvent('order.placed', {} as never)).toThrow(new TypeError(message))
    expect(() => defineEvent('order.placed', null as never)).toThrow(new TypeError(message))
  })
})

describe('dlqEvent', () => {
  it('names <topic>.dlq and carries no schema', () => {
    const dead = dlqEvent(OrderPlaced)
    expect(dead.topic).toBe('order.placed.dlq')
    expect(dead.schema).toBeUndefined()
  })

  it('takes only a contract', () => {
    expect(() => dlqEvent('order.placed' as never)).toThrow(
      new TypeError(
        "[messaging] dlqEvent() takes an event contract from defineEvent(), got the string 'order.placed' - " +
          "define it with defineEvent('order.placed', schema)",
      ),
    )
    expect(() => dlqEvent({} as never)).toThrow(
      new TypeError('[messaging] dlqEvent() takes an event contract from defineEvent()'),
    )
  })
})

describe('event types', () => {
  it('derive the payload from the schema output and the publish input from its input', () => {
    const Length = defineEvent(
      'text.length',
      z.string().transform((s) => s.length),
    )
    const Stamped = defineEvent('stamped', z.object({ at: z.coerce.date() }))

    const checks: [
      Equal<OrderPlaced, { id: string; total: number }>,
      Equal<EventPayload<typeof Length>, number>,
      Equal<EventInput<typeof Length>, string>,
      Equal<EventPayload<typeof Stamped>, { at: Date }>,
      Equal<EventPayload<typeof Ping>, unknown>,
      Equal<EventInput<typeof Ping>, unknown>,
      Equal<EventPayload<ReturnType<typeof dlqEvent>>, unknown>,
    ] = [true, true, true, true, true, true, true]
    expect(checks.every(Boolean)).toBe(true)
  })

  it('check the handler parameter against the event', () => {
    interface User {
      id: string
    }
    const UserCreated = defineEvent('user.created', z.object({ id: z.string(), email: z.string() }))
    const UserUpdated = defineEvent('user.updated', z.object({ id: z.string(), name: z.string() }))

    class Handlers {
      @On(OrderPlaced)
      onPlaced(_order: OrderPlaced, _meta: MessageMeta) {}

      // @ts-expect-error - the parameter does not match the schema output
      @On(OrderPlaced)
      onWrongType(_order: { id: number }) {}

      @On(Ping)
      onPing(_payload: unknown) {}

      // @ts-expect-error - an event without a schema delivers unknown
      @On(Ping)
      onPingTyped(_payload: { id: string }) {}

      // One method, two events: the parameter only has to fit both payloads.
      @On(UserCreated)
      @On(UserUpdated)
      onUser(_user: User) {}

      @On(OrderPlaced)
      #onPrivate(_order: OrderPlaced) {}
    }

    expect(Handlers).toBeFunction()
  })

  it('check the publish() payload against the schema input', () => {
    const Length = defineEvent(
      'text.length',
      z.string().transform((s) => s.length),
    )
    const Stamped = defineEvent('stamped', z.object({ at: z.coerce.date() }))

    // Never called: the calls are here for the compiler.
    const publishAll = (bus: MessageBus) => [
      bus.publish(OrderPlaced, { id: 'o-1', total: 42 }),
      // @ts-expect-error - total is a number
      bus.publish(OrderPlaced, { id: 'o-1', total: '42' }),
      // @ts-expect-error - total is missing
      bus.publish(OrderPlaced, { id: 'o-1' }),
      bus.publish(Length, 'hello'),
      // @ts-expect-error - a transform takes its input type, not its output
      bus.publish(Length, 5),
      bus.publish(Stamped, { at: '2026-10-31T12:00:00.000Z' }),
      bus.publish(Stamped, { at: new Date() }),
      bus.publish(Stamped, { at: 1_793_448_000_000 }),
      bus.publish(Ping, { anything: true }),
    ]

    expect(publishAll).toBeFunction()
  })
})
