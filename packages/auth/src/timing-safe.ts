import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto'

const encoder = new TextEncoder()

/**
 * Constant-time equality check for two strings of the same expected length
 * (e.g. pre-hashed tokens, HMAC digests, API keys).
 *
 * **Not suitable for plaintext password comparison** - use `bcrypt.compare`
 * or `argon2.verify` instead, which handle salting and proper cost factors.
 *
 * Returns `false` immediately (non-constant-time) when lengths differ; callers
 * should ensure inputs are the same expected length before calling.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  if (bufA.length !== bufB.length) return false
  return nodeTimingSafeEqual(bufA, bufB)
}
