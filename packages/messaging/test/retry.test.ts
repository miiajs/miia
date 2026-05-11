import { describe, expect, it } from 'bun:test'
import { dlqTopic, nextBackoffMs } from '../src/retry.js'
import type { RetryConfig } from '../src/types.js'

const CONFIG: RetryConfig = {
  maxAttempts: 5,
  backoffMs: 100,
  backoffMultiplier: 2,
  dlq: true,
}

describe('nextBackoffMs', () => {
  it('returns base delay on first attempt', () => {
    expect(nextBackoffMs(1, CONFIG)).toBe(100)
  })

  it('applies exponential multiplier per attempt', () => {
    expect(nextBackoffMs(2, CONFIG)).toBe(200)
    expect(nextBackoffMs(3, CONFIG)).toBe(400)
    expect(nextBackoffMs(4, CONFIG)).toBe(800)
    expect(nextBackoffMs(5, CONFIG)).toBe(1600)
  })

  it('supports non-integer multipliers', () => {
    const config: RetryConfig = { ...CONFIG, backoffMultiplier: 1.5 }
    expect(nextBackoffMs(1, config)).toBe(100)
    expect(nextBackoffMs(2, config)).toBe(150)
    expect(nextBackoffMs(3, config)).toBe(225)
  })
})

describe('dlqTopic', () => {
  it('appends .dlq suffix', () => {
    expect(dlqTopic('user.created')).toBe('user.created.dlq')
    expect(dlqTopic('orders')).toBe('orders.dlq')
  })

  it('does not double-suffix (idempotency is caller responsibility)', () => {
    // Documentation test: the function is dumb and only knows about concatenation.
    // Callers must not pass a DLQ topic back in - it would yield .dlq.dlq.
    expect(dlqTopic('orders.dlq')).toBe('orders.dlq.dlq')
  })
})
