/**
 * Default number of connection attempts before giving up.
 * Override via PaprModuleOptions.connection.retry.attempts.
 */
export const DEFAULT_RETRY_ATTEMPTS = 3

/**
 * Default delay (ms) between connection retries.
 * Override via PaprModuleOptions.connection.retry.delay.
 */
export const DEFAULT_RETRY_DELAY = 2_000

/**
 * Node.js network error codes considered retryable during connection.
 * Non-retryable errors (e.g. auth failure) abort immediately.
 */
export const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
])

/** Logger context tag for this package. */
export const LOGGER_CONTEXT = 'PaprModule'
