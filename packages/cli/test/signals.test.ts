import { describe, expect, it } from 'bun:test'
import { childExitCode, createSignalPolicy, signalExitCode } from '../src/dev/signals.js'

function clock(start = 0) {
  let time = start
  return { now: () => time, advance: (ms: number) => (time += ms) }
}

describe('createSignalPolicy', () => {
  it('forwards the first signal', () => {
    const policy = createSignalPolicy({ now: clock().now })
    expect(policy('SIGINT')).toBe('forward')
  })

  it('ignores duplicates inside the window, of any type', () => {
    const c = clock()
    const policy = createSignalPolicy({ now: c.now })
    expect(policy('SIGINT')).toBe('forward')
    c.advance(5)
    expect(policy('SIGINT')).toBe('ignore')
    c.advance(500)
    expect(policy('SIGTERM')).toBe('ignore')
    c.advance(495)
    expect(policy('SIGHUP')).toBe('ignore')
  })

  it('kills on a signal after the window', () => {
    const c = clock()
    const policy = createSignalPolicy({ now: c.now })
    policy('SIGTERM')
    c.advance(1001)
    expect(policy('SIGINT')).toBe('kill')
    expect(policy('SIGINT')).toBe('kill')
  })

  it('honours a custom window', () => {
    const c = clock()
    const policy = createSignalPolicy({ now: c.now, duplicateWindowMs: 50 })
    policy('SIGINT')
    c.advance(51)
    expect(policy('SIGINT')).toBe('kill')
  })
})

describe('childExitCode', () => {
  it('lets a non-zero app code win, then the forwarded signal, then the signal that ended it', () => {
    expect(childExitCode({ exitCode: 3 }, 'SIGINT')).toBe(3)
    expect(childExitCode({ exitCode: 0 }, 'SIGINT')).toBe(130)
    expect(childExitCode({ signal: 'SIGKILL' }, 'SIGTERM')).toBe(143)
    expect(childExitCode({ signal: 'SIGKILL' }, null)).toBe(137)
    expect(childExitCode({ exitCode: 0 }, null)).toBe(0)
    expect(childExitCode({ exitCode: 42 }, null)).toBe(42)
  })
})

describe('signalExitCode', () => {
  it('is 128 + the signal number', () => {
    expect(signalExitCode('SIGINT')).toBe(130)
    expect(signalExitCode('SIGTERM')).toBe(143)
  })
})
