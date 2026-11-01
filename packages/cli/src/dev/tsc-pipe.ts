import { colors } from 'consola/utils'
import type { ResultPromise } from 'execa'

// `7:08:25 AM - `, `19:08:25 - `, `[7:08:25 pm] - ` (en-AU, en-IN)
const TSC_TIMESTAMP = /^\[?\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?\]?\s+-\s+/i
const TSC_ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/

export function formatTscLine(line: string): string | null {
  const clean = line.replace(/\r/g, '').replace(TSC_TIMESTAMP, '')
  if (!clean.trim()) return null

  if (/Starting compilation in watch mode|File change detected/.test(clean)) return null
  if (/Found 0 errors/.test(clean)) return colors.green('No type errors found')
  if (/Found \d+ errors?/.test(clean)) return colors.red(clean)

  const match = TSC_ERROR_LINE.exec(clean)
  if (match) {
    const [, file, ln, col, code, msg] = match
    return `${colors.red('ERROR')} in ${colors.blue(`${file}:${ln}:${col}`)}\n${code}: ${msg}`
  }

  return clean
}

export function pipeTsc(proc: ResultPromise): void {
  let buffer = ''
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const formatted = formatTscLine(line)
      if (formatted !== null) process.stdout.write(`${formatted}\n`)
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk)
  })
}
