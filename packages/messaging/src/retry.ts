import type { RetryConfig } from './types.js'

/**
 * Exponential backoff: attempt=1 → base, attempt=2 → base*mult, ...
 */
export function nextBackoffMs(attempt: number, config: RetryConfig): number {
  return config.backoffMs * Math.pow(config.backoffMultiplier, attempt - 1)
}

export function dlqTopic(topic: string): string {
  return `${topic}.dlq`
}
