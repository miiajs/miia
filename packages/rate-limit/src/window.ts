const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

const WINDOW_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/

/**
 * Parse a window value into milliseconds. Accepts a positive finite number
 * (interpreted as ms) or a duration string like `'500ms'`, `'10s'`, `'5m'`,
 * `'1h'`, `'1d'`. Throws `TypeError` on anything else.
 */
export function parseWindow(window: number | string): number {
  if (typeof window === 'number') {
    if (!Number.isFinite(window) || window <= 0) {
      throw new TypeError(`[RateLimit] Invalid window: ${window}. Expected a positive finite number of milliseconds.`)
    }
    return window
  }

  if (typeof window === 'string') {
    const match = WINDOW_RE.exec(window.trim())
    if (match) {
      const value = Number.parseFloat(match[1])
      const ms = value * UNIT_MS[match[2]]
      if (Number.isFinite(ms) && ms > 0) {
        return Math.round(ms)
      }
    }
  }

  throw new TypeError(
    `[RateLimit] Invalid window: ${String(window)}. Expected a positive number (ms) or a duration string like '10s', '5m', '1h'.`,
  )
}
