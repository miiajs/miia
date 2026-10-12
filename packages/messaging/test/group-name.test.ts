import { describe, expect, it } from 'bun:test'
import { hostname } from 'node:os'
import { deriveGroupName } from '../src/group-name.js'

const registry = globalThis as unknown as Record<symbol, string | undefined>
const TOKEN = Symbol.for('miia.messaging.processToken')

describe('deriveGroupName', () => {
  it('auto-derives without appName as <topic>__<ctor>_<method>', () => {
    expect(
      deriveGroupName({
        topic: 'user.created',
        ctorName: 'EmailService',
        methodName: 'send',
        appName: null,
      }),
    ).toBe('user.created__EmailService_send')
  })

  it('auto-derives with appName as <appName>:<topic>__<ctor>_<method>', () => {
    expect(
      deriveGroupName({
        topic: 'user.created',
        ctorName: 'EmailService',
        methodName: 'send',
        appName: 'auth-service',
      }),
    ).toBe('auth-service:user.created__EmailService_send')
  })

  it('returns explicitGroup as-is, ignores appName', () => {
    expect(
      deriveGroupName({
        topic: 'jobs',
        ctorName: 'Worker',
        methodName: 'run',
        appName: 'app',
        explicitGroup: 'shared-pool',
      }),
    ).toBe('shared-pool')
  })

  it('returns explicitGroup as-is even when broadcast is set (utility does not validate)', () => {
    // Validation of broadcast + group mutual exclusion lives in MessageBus.onReady,
    // not in this pure utility.
    expect(
      deriveGroupName({
        topic: 'topic',
        ctorName: 'X',
        methodName: 'y',
        appName: null,
        explicitGroup: 'override',
        broadcast: true,
      }),
    ).toBe('override')
  })

  it('appends __<hostname>_<pid>_<token> when broadcast is true', () => {
    const result = deriveGroupName({
      topic: 'cache.invalidate',
      ctorName: 'CacheService',
      methodName: 'flush',
      appName: null,
      broadcast: true,
    })
    expect(registry[TOKEN]).toMatch(/^[0-9a-f]{8}$/)
    expect(result).toBe(`cache.invalidate__CacheService_flush__${hostname()}_${process.pid}_${registry[TOKEN]}`)
  })

  it('combines appName prefix and broadcast suffix', () => {
    const result = deriveGroupName({
      topic: 'cache.invalidate',
      ctorName: 'CacheService',
      methodName: 'flush',
      appName: 'svc',
      broadcast: true,
    })
    expect(result).toBe(`svc:cache.invalidate__CacheService_flush__${hostname()}_${process.pid}_${registry[TOKEN]}`)
  })

  it('draws the token once per process', () => {
    // Every broadcast group of the process carries the same owner, so one liveness key covers them all.
    const a = deriveGroupName({
      topic: 't',
      ctorName: 'C',
      methodName: 'm',
      appName: null,
      broadcast: true,
    })
    const b = deriveGroupName({
      topic: 't',
      ctorName: 'C',
      methodName: 'm',
      appName: null,
      broadcast: true,
    })
    expect(a).toBe(b)
  })

  it('reads the token from globalThis, so two copies of the package in one process agree', () => {
    const own = registry[TOKEN]
    registry[TOKEN] = 'cafebabe'
    try {
      const result = deriveGroupName({ topic: 't', ctorName: 'C', methodName: 'm', appName: null, broadcast: true })
      expect(result).toBe(`t__C_m__${hostname()}_${process.pid}_cafebabe`)
    } finally {
      registry[TOKEN] = own
    }
  })
})
