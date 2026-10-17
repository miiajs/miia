import { describe, expect, it } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'
import { formatTscLine } from '../src/dev/tsc-pipe.js'

const plain = (line: string) => {
  const formatted = formatTscLine(line)
  return formatted === null ? null : stripVTControlCharacters(formatted)
}

describe('formatTscLine', () => {
  it('strips 12-hour timestamps', () => {
    expect(plain('7:08:25 AM - Starting compilation in watch mode...')).toBe('Type-checking in progress...')
    expect(plain('11:59:59 PM - File change detected. Starting incremental compilation...')).toBe(
      'File changed, rechecking...',
    )
  })

  it('strips 24-hour and lower-case am/pm timestamps', () => {
    expect(plain('19:08:25 - Found 0 errors. Watching for file changes.')).toBe('No errors found.')
    expect(plain('[7:08:25 pm] - Found 0 errors. Watching for file changes.')).toBe('No errors found.')
    expect(plain('7:08:25 AM - Found 0 errors. Watching for file changes.')).toBe('No errors found.')
  })

  it('keeps timestamp-looking text that is not at the line start', () => {
    expect(plain('note: 7:08:25 AM - x')).toBe('note: 7:08:25 AM - x')
  })

  it('drops carriage returns', () => {
    expect(plain('7:08:25 AM - Found 0 errors. Watching for file changes.\r')).toBe('No errors found.')
    expect(plain('\r')).toBeNull()
  })

  it('reformats error lines', () => {
    expect(plain("src/a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.")).toBe(
      "ERROR in src/a.ts:1:7\nTS2322: Type 'string' is not assignable to type 'number'.",
    )
  })

  it('keeps the error summary', () => {
    expect(plain('7:08:26 AM - Found 2 errors. Watching for file changes.')).toBe(
      'Found 2 errors. Watching for file changes.',
    )
    expect(plain('Found 1 error. Watching for file changes.')).toBe('Found 1 error. Watching for file changes.')
  })

  it('skips blank lines', () => {
    expect(plain('')).toBeNull()
    expect(plain('   ')).toBeNull()
  })
})
