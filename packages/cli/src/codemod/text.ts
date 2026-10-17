function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function appendLines(text: string, lines: string[]): string {
  if (lines.length === 0) return text
  const eol = eolOf(text)
  const prefix = text.length === 0 || /\r?\n$/.test(text) ? text : text + eol
  return prefix + lines.join(eol) + eol
}

/** `.env` entries: skips keys that are already assigned. */
export function addEnvEntries(text: string, entries: Array<[key: string, value: string]>): string {
  const keys = new Set(
    text
      .split('\n')
      .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line.replace(/\r$/, ''))?.[1])
      .filter(Boolean),
  )
  const missing = entries.filter(([key]) => !keys.has(key))
  return appendLines(
    text,
    missing.map(([key, value]) => `${key}=${value}`),
  )
}

/** `.gitignore` lines: skips lines that are already there. */
export function addLines(text: string, lines: string[]): string {
  const present = new Set(text.split('\n').map((line) => line.replace(/\r$/, '').trim()))
  return appendLines(
    text,
    lines.filter((line) => !present.has(line.trim())),
  )
}
