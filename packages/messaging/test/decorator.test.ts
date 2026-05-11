import { describe, expect, it } from 'bun:test'
import { getMeta } from '@miiajs/core'
import { On, ON, type OnMeta } from '../src/decorators.js'

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
})
