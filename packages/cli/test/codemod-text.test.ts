import { describe, expect, it } from 'bun:test'
import { importSpecifier } from '../src/codemod/paths.js'
import { addEnvEntries, addLines, addSection } from '../src/codemod/text.js'

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

describe('addSection', () => {
  const opts = { heading: '## Database', before: '## Next steps' }
  const section = '## Database\n\nStart it.\n'

  it('goes before the `before` heading', () => {
    expect(addSection('# App\n\n## Scripts\n\nx\n\n## Next steps\n\n- y\n', section, opts)).toBe(
      '# App\n\n## Scripts\n\nx\n\n## Database\n\nStart it.\n\n## Next steps\n\n- y\n',
    )
    expect(addSection('# App\nx\n## Next steps\n', section, opts)).toBe(
      '# App\nx\n\n## Database\n\nStart it.\n\n## Next steps\n',
    )
  })

  it('goes at the end without the `before` heading', () => {
    expect(addSection('# App\n\nx\n\n', section, opts)).toBe('# App\n\nx\n\n## Database\n\nStart it.\n')
    expect(addSection('# App', section, { heading: '## Database' })).toBe('# App\n\n## Database\n\nStart it.\n')
    expect(addSection('', section, opts)).toBe('## Database\n\nStart it.\n')
  })

  it('leaves the text alone when the heading is there', () => {
    const text = '# App\n\n## Database \n\nMine.\n\n## Next steps\n'
    expect(addSection(text, section, opts)).toBe(text)
  })

  it('keeps CRLF', () => {
    expect(addSection('# App\r\n\r\n## Next steps\r\n', section, opts)).toBe(
      '# App\r\n\r\n## Database\r\n\r\nStart it.\r\n\r\n## Next steps\r\n',
    )
  })
})

describe('importSpecifier', () => {
  it('is relative, posix and .js', () => {
    expect(importSpecifier('src/app/app.module.ts', 'src/users/users.module.ts')).toBe('../users/users.module.js')
    expect(importSpecifier('src/app/app.module.ts', 'src/app/users/users.module.ts')).toBe('./users/users.module.js')
    expect(importSpecifier('src\\app\\app.module.ts', 'src\\app\\x.service.ts')).toBe('./x.service.js')
  })
})
