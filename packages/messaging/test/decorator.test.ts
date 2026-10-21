import { describe, expect, it } from 'bun:test'
import { getMeta } from '@miiajs/core'
import { IDEMPOTENT, Idempotent, type IdempotentMeta, On, ON, type OnMeta } from '../src/decorators.js'
import type { MessageMeta } from '../src/types.js'

describe('@On decorator', () => {
  it('writes metadata with topic and handlerName', () => {
    class S {
      @On('user.created')
      handleUserCreated() {}
    }

    const items = getMeta<OnMeta[]>(S, ON)
    expect(items).toHaveLength(1)
    expect(items![0]).toEqual({
      topic: 'user.created',
      handlerName: 'handleUserCreated',
      group: undefined,
      concurrency: undefined,
    })
  })

  it('stores group and concurrency when provided', () => {
    class S {
      @On('user.created', { group: 'workers', concurrency: 4 })
      handle() {}
    }

    const items = getMeta<OnMeta[]>(S, ON)
    expect(items![0]).toMatchObject({
      topic: 'user.created',
      group: 'workers',
      concurrency: 4,
    })
  })

  it('stores initialPosition when provided', () => {
    class S {
      @On('media.video', { initialPosition: { since: 3_600_000 } })
      handle() {}
    }

    const items = getMeta<OnMeta[]>(S, ON)
    expect(items![0]?.initialPosition).toEqual({ since: 3_600_000 })
  })

  it('accumulates multiple @On on the same class', () => {
    class S {
      @On('a')
      onA() {}

      @On('b')
      onB() {}

      @On('c', { group: 'g' })
      onC() {}
    }

    const items = getMeta<OnMeta[]>(S, ON)
    expect(items).toHaveLength(3)
    const byTopic = Object.fromEntries(items!.map((i) => [i.topic, i]))
    expect(byTopic.a?.handlerName).toBe('onA')
    expect(byTopic.b?.handlerName).toBe('onB')
    expect(byTopic.c?.group).toBe('g')
  })

  it('allows multiple @On on the same method (same method, different topics)', () => {
    class S {
      @On('created')
      @On('updated')
      handleAny() {}
    }

    const items = getMeta<OnMeta[]>(S, ON)
    expect(items).toHaveLength(2)
    expect(items!.map((i) => i.topic).sort()).toEqual(['created', 'updated'])
    expect(items!.every((i) => i.handlerName === 'handleAny')).toBe(true)
  })

  it('a subclass @On does not change the parent list', () => {
    class Parent {
      @On('a')
      onA() {}
    }

    class Child extends Parent {
      @On('b')
      onB() {}
    }

    expect(getMeta<OnMeta[]>(Parent, ON)!.map((i) => i.topic)).toEqual(['a'])
    expect(getMeta<OnMeta[]>(Child, ON)!.map((i) => i.topic)).toEqual(['a', 'b'])
  })
})

describe('@Idempotent decorator', () => {
  interface Payment {
    id: string
  }

  it('takes a key typed by the payload', () => {
    class S {
      @Idempotent({ ttl: 60_000, key: (p: Payment) => `payment:${p.id}` })
      onPayment(_payment: Payment) {}

      @Idempotent({ ttl: 60_000, key: (_p, meta) => `at:${meta.timestamp}` })
      onAny() {}

      // @ts-expect-error - key must return a string
      @Idempotent({ ttl: 60_000, key: (p: Payment) => p.id.length })
      onWrongKey() {}
    }

    const meta = getMeta<Map<string, IdempotentMeta>>(S, IDEMPOTENT)!
    expect(meta.get('onPayment')!.key!({ id: 'p1' }, {} as MessageMeta)).toBe('payment:p1')
    expect(meta.get('onAny')!.ttl).toBe(60_000)
  })
})
