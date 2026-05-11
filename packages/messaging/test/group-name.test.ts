import { describe, expect, it } from 'bun:test'
import { hostname } from 'node:os'
import { deriveGroupName } from '../src/group-name.js'

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

  it('appends __<hostname>_<pid> when broadcast is true', () => {
    const result = deriveGroupName({
      topic: 'cache.invalidate',
      ctorName: 'CacheService',
      methodName: 'flush',
      appName: null,
      broadcast: true,
    })
    expect(result).toBe(`cache.invalidate__CacheService_flush__${hostname()}_${process.pid}`)
  })

  it('combines appName prefix and broadcast suffix', () => {
    const result = deriveGroupName({
      topic: 'cache.invalidate',
      ctorName: 'CacheService',
      methodName: 'flush',
      appName: 'svc',
      broadcast: true,
    })
    expect(result).toBe(`svc:cache.invalidate__CacheService_flush__${hostname()}_${process.pid}`)
  })

  it('does not append random suffix - hostname+pid is the full per-process identity', () => {
    // The orphan-cleanup logic in transports relies on the suffix being stable
    // (only host+pid). Random component would prevent matching prior incarnations.
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
})
