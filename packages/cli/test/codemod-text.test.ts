import { describe, expect, it } from 'bun:test'
import { importSpecifier } from '../src/codemod/paths.js'
import { addEnvEntries, addLines } from '../src/codemod/text.js'

describe('addEnvEntries', () => {
  it('appends missing keys', () => {
    expect(
      addEnvEntries('PORT=3000\n', [
        ['JWT_SECRET', 'abc'],
        ['PORT', '1'],
      ]),
    ).toBe('PORT=3000\nJWT_SECRET=abc\n')
  })

  it('recognizes export, spaces and CRLF', () => {
    const text = 'export PORT = 3000\r\n# HOST=x\r\n'
    expect(
      addEnvEntries(text, [
        ['PORT', '1'],
        ['HOST', '0.0.0.0'],
      ]),
    ).toBe('export PORT = 3000\r\n# HOST=x\r\nHOST=0.0.0.0\r\n')
  })

  it('adds a newline before appending to a file without one', () => {
    expect(addEnvEntries('A=1', [['B', '2']])).toBe('A=1\nB=2\n')
    expect(addEnvEntries('', [['B', '2']])).toBe('B=2\n')
  })

  it('returns the same text when nothing is missing', () => {
    expect(addEnvEntries('A=1', [['A', '2']])).toBe('A=1')
  })
})

describe('addLines', () => {
  it('skips present lines', () => {
    expect(addLines('node_modules/\r\n.env\r\n', ['.env', 'data.db'])).toBe('node_modules/\r\n.env\r\ndata.db\r\n')
    expect(addLines('dist/\n', ['dist/'])).toBe('dist/\n')
  })
})

describe('importSpecifier', () => {
  it('is relative, posix and .js', () => {
    expect(importSpecifier('src/app/app.module.ts', 'src/users/users.module.ts')).toBe('../users/users.module.js')
    expect(importSpecifier('src/app/app.module.ts', 'src/app/users/users.module.ts')).toBe('./users/users.module.js')
    expect(importSpecifier('src\\app\\app.module.ts', 'src\\app\\x.service.ts')).toBe('./x.service.js')
  })
})
