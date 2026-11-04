function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function appendLines(text: string, lines: string[]): string {
  if (lines.length === 0) return text
  const eol = eolOf(text)
  const prefix = text.length === 0 || /\r?\n$/.test(text) ? text : text + eol
  return prefix + lines.join(eol) + eol
}

/** `.env` entries: skips keys that are already assigned; a comment goes on the line above its key. */
export function addEnvEntries(text: string, entries: Array<[key: string, value: string, comment?: string]>): string {
  const keys = new Set(
    text
      .split('\n')
      .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line.replace(/\r$/, ''))?.[1])
      .filter(Boolean),
  )
  const missing = entries.filter(([key]) => !keys.has(key))
  return appendLines(
    text,
    missing.flatMap(([key, value, comment]) => (comment ? [`# ${comment}`, `${key}=${value}`] : [`${key}=${value}`])),
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

/**
 * A Markdown section: inserted before the `before` line, else at the end. Nothing changes when the `heading`
 * line is there already.
 */
export function addSection(text: string, section: string, opts: { heading: string; before?: string }): string {
  const raw = text.split('\n')
  const lines = raw.map((line) => line.replace(/\r$/, '').trim())
  if (lines.includes(opts.heading)) return text
  const eol = eolOf(text)
  const body = section.replace(/\s+$/, '').split(/\r?\n/).join(eol) + eol

  const at = opts.before === undefined ? -1 : lines.indexOf(opts.before)
  if (at === -1) {
    const head = text.replace(/\s+$/, '')
    return head ? head + eol + eol + body : body
  }
  const offset = raw.slice(0, at).reduce((sum, line) => sum + line.length + 1, 0)
  const head = text.slice(0, offset)
  const gap = head === '' || /(^|\n)[ \t]*\r?\n$/.test(head) ? '' : eol
  return head + gap + body + eol + text.slice(offset)
}
