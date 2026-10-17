import { describe, expect, it } from 'bun:test'
import { createSignalPolicy, signalExitCode } from '../src/dev/signals.js'

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

describe('signalExitCode', () => {
  it('is 128 + the signal number', () => {
    expect(signalExitCode('SIGINT')).toBe(130)
    expect(signalExitCode('SIGTERM')).toBe(143)
  })
})
