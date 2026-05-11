import type { ResultPromise } from 'execa'

const TSC_TIMESTAMP = /\[?[\d:]+\s*[AP]M\]?\s*-\s*/
const TSC_ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/

const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`

function formatLine(line: string): string {
  if (/Starting compilation in watch mode/.test(line)) {
    return cyan('Type-checking in progress...')
  }
  if (/File change detected/.test(line)) {
    return cyan('File changed, rechecking...')
  }
  if (/Found 0 errors/.test(line)) {
    return green('No errors found.')
  }
  if (/Found \d+ error/.test(line)) {
    return red(line)
  }

  const match = TSC_ERROR_LINE.exec(line)
  if (match) {
    const [, file, ln, col, code, msg] = match
    return `${red('ERROR')} in ${blue(`${file}:${ln}:${col}`)}\n${code}: ${msg}`
  }

  return line
}

export function pipeTsc(proc: ResultPromise): void {
  let buffer = ''
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const clean = line.replace(TSC_TIMESTAMP, '')
      process.stdout.write(formatLine(clean) + '\n')
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk)
  })
}
