import { describe, expect, it } from 'bun:test'
import ts from 'typescript'
import {
  addImport,
  addSchemaKey,
  addToModuleArray,
  detectStyle,
  hasCall,
  hasModuleEntry,
  insertStatement,
  isListenCall,
} from '../src/codemod/source.js'

const lines = (...parts: string[]) => `${parts.join('\n')}\n`

describe('detectStyle', () => {
  it('reads EOL and indent unit', () => {
    expect(detectStyle('a\n  b\n    c\n')).toEqual({ eol: '\n', indent: '  ' })
    expect(detectStyle('a\r\n    b\r\n')).toEqual({ eol: '\r\n', indent: '    ' })
    expect(detectStyle('a\n\tb\n')).toEqual({ eol: '\n', indent: '\t' })
    expect(detectStyle('/**\n * doc\n */\nclass A {\n    x = 1\n}\n').indent).toBe('    ')
    expect(detectStyle('const a = 1\n').indent).toBe('  ')
  })
})

describe('addImport', () => {
  it('adds a new import after the last one', () => {
    const text = lines("import { Module } from '@miiajs/core'", "import { A } from './a.js'", '', 'export class X {}')
    expect(addImport(ts, text, { from: './b.js', names: ['B'] })).toEqual({
      status: 'added',
      text: lines(
        "import { Module } from '@miiajs/core'",
        "import { A } from './a.js'",
        "import { B } from './b.js'",
        '',
        'export class X {}',
      ),
    })
  })

  it('merges into an import from the same module', () => {
    const text = lines("import { Miia } from '@miiajs/core'", '', 'new Miia()')
    expect(addImport(ts, text, { from: '@miiajs/core', names: ['cors', 'Module'] }).text).toBe(
      lines("import { Miia, cors, Module } from '@miiajs/core'", '', 'new Miia()'),
    )
  })

  it('merges into a multi-line import on its own line', () => {
    const text = lines('import {', '  A,', '  B,', "} from './x.js'")
    expect(addImport(ts, text, { from: './x.js', names: ['C'] }).text).toBe(
      lines('import {', '  A,', '  B,', '  C,', "} from './x.js'"),
    )
  })

  it('keeps type imports apart from value imports', () => {
    const text = lines("import type { Env } from './env.js'")
    expect(addImport(ts, text, { from: './env.js', names: ['Env'] })).toEqual({ status: 'conflict', text })
    expect(addImport(ts, text, { from: './env.js', names: ['Env'], type: true }).status).toBe('exists')

    const value = lines("import { envSchema } from './env.js'")
    expect(addImport(ts, value, { from: './env.js', names: ['Env'], type: true }).text).toBe(
      lines("import { envSchema, type Env } from './env.js'"),
    )
    const both = lines("import { envSchema } from './env.js'", "import type { A } from './env.js'")
    expect(addImport(ts, both, { from: './env.js', names: ['Env'], type: true }).text).toBe(
      lines("import { envSchema } from './env.js'", "import type { A, Env } from './env.js'"),
    )
    expect(addImport(ts, lines('x()'), { from: './env.js', names: ['Env'], type: true }).text).toBe(
      lines("import type { Env } from './env.js'", '', 'x()'),
    )
  })

  it('does not take an inline type specifier for a value request', () => {
    const text = lines("import { type Foo, Bar } from './x.js'")
    expect(addImport(ts, text, { from: './x.js', names: ['Foo'] }).status).toBe('conflict')
    expect(addImport(ts, text, { from: './x.js', names: ['Bar'] }).status).toBe('exists')
  })

  it('treats an aliased import of the same export as present', () => {
    const text = lines("import { ConfigService as Cs } from '@miiajs/config'")
    expect(addImport(ts, text, { from: '@miiajs/config', names: ['ConfigService'] }).status).toBe('exists')
  })

  it('reports a conflict when the local name is taken', () => {
    const fromElsewhere = lines("import { ConfigService } from './my-config.js'")
    expect(addImport(ts, fromElsewhere, { from: '@miiajs/config', names: ['ConfigService'] })).toEqual({
      status: 'conflict',
      text: fromElsewhere,
    })
    const wrongExport = lines("import { Foo as ConfigService } from '@miiajs/config'")
    expect(addImport(ts, wrongExport, { from: '@miiajs/config', names: ['ConfigService'] }).status).toBe('conflict')
    const declared = lines('class UsersService {}')
    expect(addImport(ts, declared, { from: './users.js', names: ['UsersService'] }).status).toBe('conflict')
  })

  it('does not merge into namespace, default-only or bare imports', () => {
    const text = lines("import * as core from '@miiajs/core'", "import def from 'x'", "import 'x'")
    expect(addImport(ts, text, { from: 'x', names: ['y'] }).text).toBe(
      lines("import * as core from '@miiajs/core'", "import def from 'x'", "import 'x'", "import { y } from 'x'"),
    )
  })

  it('adds namespace imports', () => {
    const text = lines("import { Module } from '@miiajs/core'")
    expect(addImport(ts, text, { from: '../db/schema.js', namespace: 'schema' }).text).toBe(
      lines("import { Module } from '@miiajs/core'", "import * as schema from '../db/schema.js'"),
    )
    const existing = lines("import * as schema from '../db/schema.js'")
    expect(addImport(ts, existing, { from: '../db/schema.js', namespace: 'schema' }).status).toBe('exists')
    expect(addImport(ts, existing, { from: './other.js', namespace: 'schema' }).status).toBe('conflict')
  })

  it('goes after a trailing comment of the last import', () => {
    const text = lines("import { A } from './a.js' // keep", '', 'A')
    expect(addImport(ts, text, { from: './b.js', names: ['B'] }).text).toBe(
      lines("import { A } from './a.js' // keep", "import { B } from './b.js'", '', 'A'),
    )
  })

  it('handles a file without imports, after shebang and reference directives', () => {
    expect(addImport(ts, lines('const a = 1'), { from: 'x', names: ['y'] }).text).toBe(
      lines("import { y } from 'x'", '', 'const a = 1'),
    )
    expect(addImport(ts, '', { from: 'x', names: ['y'] }).text).toBe(lines("import { y } from 'x'"))
    const text = lines('#!/usr/bin/env node', '/// <reference types="bun" />', '', 'run()')
    expect(addImport(ts, text, { from: 'x', names: ['run'] }).text).toBe(
      lines('#!/usr/bin/env node', '/// <reference types="bun" />', "import { run } from 'x'", '', 'run()'),
    )
  })

  it('follows quote, semicolon and CRLF style', () => {
    const text = 'import { A } from "./a.js";\r\n\r\nA;\r\n'
    expect(addImport(ts, text, { from: './b.js', names: ['B'] }).text).toBe(
      'import { A } from "./a.js";\r\nimport { B } from "./b.js";\r\n\r\nA;\r\n',
    )
  })
})

describe('addToModuleArray', () => {
  const module = (...body: string[]) =>
    lines("import { Module } from '@miiajs/core'", '', '@Module({', ...body, '})', 'export class AppModule {}')

  it('adds a missing key in module key order', () => {
    const text = module('  controllers: [AppController],', '  providers: [AppService],')
    expect(addToModuleArray(ts, text, { key: 'imports', element: 'UsersModule', ref: 'UsersModule' })).toEqual({
      status: 'added',
      text: module('  imports: [UsersModule],', '  controllers: [AppController],', '  providers: [AppService],'),
    })
    expect(addToModuleArray(ts, text, { key: 'exports', element: 'AppService', ref: 'AppService' }).text).toBe(
      module('  controllers: [AppController],', '  providers: [AppService],', '  exports: [AppService],'),
    )
  })

  it('appends to a one-line array', () => {
    const text = module('  providers: [A, B],')
    expect(addToModuleArray(ts, text, { key: 'providers', element: 'C', ref: 'C' }).text).toBe(
      module('  providers: [A, B, C],'),
    )
  })

  it('appends to a multi-line array and keeps its trailing comma', () => {
    const text = module('  imports: [', '    ConfigModule,', '    UsersModule,', '  ],')
    expect(addToModuleArray(ts, text, { key: 'imports', element: 'PostsModule', ref: 'PostsModule' }).text).toBe(
      module('  imports: [', '    ConfigModule,', '    UsersModule,', '    PostsModule,', '  ],'),
    )
  })

  it('appends to a multi-line array without a trailing comma', () => {
    const text = module('  imports: [', '    ConfigModule, // config', '    UsersModule // users', '  ],')
    expect(addToModuleArray(ts, text, { key: 'imports', element: 'PostsModule', ref: 'PostsModule' }).text).toBe(
      module('  imports: [', '    ConfigModule, // config', '    UsersModule, // users', '    PostsModule', '  ],'),
    )
  })

  it('fills an empty array', () => {
    expect(addToModuleArray(ts, module('  imports: [],'), { key: 'imports', element: 'A', ref: 'A' }).text).toBe(
      module('  imports: [A],'),
    )
  })

  it('turns a one-line array multi-line for a multi-line element', () => {
    const element = 'JwtModule.configure(\n  { secret: "x" },\n  { global: true },\n)'
    const text = module('  imports: [UsersModule],')
    expect(addToModuleArray(ts, text, { key: 'imports', element, ref: 'JwtModule' }).text).toBe(
      module(
        '  imports: [',
        '    UsersModule,',
        '    JwtModule.configure(',
        '      { secret: "x" },',
        '      { global: true },',
        '    ),',
        '  ],',
      ),
    )
    expect(addToModuleArray(ts, module('  imports: [],'), { key: 'imports', element, ref: 'JwtModule' }).text).toBe(
      module(
        '  imports: [',
        '    JwtModule.configure(',
        '      { secret: "x" },',
        '      { global: true },',
        '    ),',
        '  ],',
      ),
    )
  })

  it('adds a new key holding a multi-line element', () => {
    const element = 'JwtModule.configure(\n  { secret: "x" },\n)'
    const text = module('  controllers: [AppController],')
    expect(addToModuleArray(ts, text, { key: 'imports', element, ref: 'JwtModule' }).text).toBe(
      module(
        '  imports: [',
        '    JwtModule.configure(',
        '      { secret: "x" },',
        '    ),',
        '  ],',
        '  controllers: [AppController],',
      ),
    )
  })

  it('recognizes existing references', () => {
    const text = module(
      '  imports: [ConfigModule.configure({ schema }, { global: true }), forwardRef(() => UsersModule), PostsModule],',
    )
    for (const ref of ['ConfigModule', 'UsersModule', 'PostsModule']) {
      expect(addToModuleArray(ts, text, { key: 'imports', element: ref, ref })).toEqual({ status: 'exists', text })
    }
  })

  it('recognizes shorthand and string keys instead of duplicating them', () => {
    const shorthand = module('  imports,')
    expect(addToModuleArray(ts, shorthand, { key: 'imports', element: 'A', ref: 'A' }).status).toBe('unsupported')
    const quoted = module("  'imports': [B],")
    expect(addToModuleArray(ts, quoted, { key: 'imports', element: 'A', ref: 'A' }).text).toBe(
      module("  'imports': [B, A],"),
    )
  })

  it('reports unsupported shapes', () => {
    const variable = module('  imports: sharedImports,')
    expect(addToModuleArray(ts, variable, { key: 'imports', element: 'A', ref: 'A' }).status).toBe('unsupported')
    const spread = module('  ...base,', '  controllers: [AppController],')
    expect(addToModuleArray(ts, spread, { key: 'imports', element: 'A', ref: 'A' }).status).toBe('unsupported')
    const config = lines("import { Module } from '@miiajs/core'", '', '@Module(config)', 'export class AppModule {}')
    expect(addToModuleArray(ts, config, { key: 'imports', element: 'A', ref: 'A' }).status).toBe('unsupported')
    expect(
      addToModuleArray(ts, lines('export class Plain {}'), { key: 'imports', element: 'A', ref: 'A' }).status,
    ).toBe('unsupported')
  })

  it('a spread does not block a key that is already there', () => {
    const text = module('  ...base,', '  imports: [B],')
    expect(addToModuleArray(ts, text, { key: 'imports', element: 'A', ref: 'A' }).text).toBe(
      module('  ...base,', '  imports: [B, A],'),
    )
  })

  it('expands @Module({}) and keeps the class indent', () => {
    const text = lines("import { Module as M } from '@miiajs/core'", '', '@M({})', 'export default class AppModule {}')
    expect(addToModuleArray(ts, text, { key: 'providers', element: 'A', ref: 'A' }).text).toBe(
      lines(
        "import { Module as M } from '@miiajs/core'",
        '',
        '@M({',
        '  providers: [A],',
        '})',
        'export default class AppModule {}',
      ),
    )
  })

  it('edits the requested class when a file has two modules', () => {
    const text = lines(
      "import { Module } from '@miiajs/core'",
      '',
      '@Module({ providers: [A] })',
      'class Inner {}',
      '',
      '@Module({ imports: [Inner] })',
      'export class Outer {}',
    )
    expect(addToModuleArray(ts, text, { key: 'imports', element: 'B', ref: 'B', moduleClass: 'Outer' }).text).toBe(
      lines(
        "import { Module } from '@miiajs/core'",
        '',
        '@Module({ providers: [A] })',
        'class Inner {}',
        '',
        '@Module({ imports: [Inner, B] })',
        'export class Outer {}',
      ),
    )
    expect(addToModuleArray(ts, text, { key: 'exports', element: 'A', ref: 'A' }).text).toContain(
      '@Module({ providers: [A], exports: [A] })',
    )
    expect(addToModuleArray(ts, text, { key: 'imports', element: 'B', ref: 'B', moduleClass: 'Missing' }).status).toBe(
      'unsupported',
    )
  })

  it('inserts before a commented property', () => {
    const text = module('  // controllers of the app', '  controllers: [AppController],')
    expect(addToModuleArray(ts, text, { key: 'imports', element: 'A', ref: 'A' }).text).toBe(
      module('  imports: [A],', '  // controllers of the app', '  controllers: [AppController],'),
    )
  })

  it('adds a property after the last one without a trailing comma', () => {
    const text = module('  controllers: [AppController] // root')
    expect(addToModuleArray(ts, text, { key: 'providers', element: 'A', ref: 'A' }).text).toBe(
      module('  controllers: [AppController], // root', '  providers: [A]'),
    )
  })

  it('keeps CRLF and tabs', () => {
    const text =
      "import { Module } from '@miiajs/core'\r\n\r\n@Module({\r\n\timports: [\r\n\t\tA,\r\n\t],\r\n})\r\nexport class M {}\r\n"
    expect(addToModuleArray(ts, text, { key: 'imports', element: 'B', ref: 'B' }).text).toBe(
      "import { Module } from '@miiajs/core'\r\n\r\n@Module({\r\n\timports: [\r\n\t\tA,\r\n\t\tB,\r\n\t],\r\n})\r\nexport class M {}\r\n",
    )
    expect(addToModuleArray(ts, text, { key: 'providers', element: 'S', ref: 'S' }).text).toBe(
      "import { Module } from '@miiajs/core'\r\n\r\n@Module({\r\n\timports: [\r\n\t\tA,\r\n\t],\r\n\tproviders: [S],\r\n})\r\nexport class M {}\r\n",
    )
  })
})

describe('hasModuleEntry', () => {
  it('finds references in a key of the module', () => {
    const text = lines(
      "import { Module } from '@miiajs/core'",
      '',
      '@Module({ imports: [ConfigModule.configure({}, { global: true })], providers: [A] })',
      'export class M {}',
    )
    expect(hasModuleEntry(ts, text, { key: 'imports', ref: 'ConfigModule' })).toBe(true)
    expect(hasModuleEntry(ts, text, { key: 'imports', ref: 'A' })).toBe(false)
    expect(hasModuleEntry(ts, text, { key: 'providers', ref: 'A' })).toBe(true)
    expect(hasModuleEntry(ts, lines('export class M {}'), { key: 'imports', ref: 'A' })).toBe(false)
  })
})

describe('addSchemaKey', () => {
  const schema = (...body: string[]) =>
    lines("import { z } from 'zod'", '', 'export const envSchema = z.object({', ...body, '})')

  it('adds a key at the end', () => {
    expect(
      addSchemaKey(ts, schema('  PORT: z.coerce.number(),'), { key: 'JWT_SECRET', value: 'z.string().min(32)' }),
    ).toEqual({
      status: 'added',
      text: schema('  PORT: z.coerce.number(),', '  JWT_SECRET: z.string().min(32),'),
    })
  })

  it('reports existing keys and missing schemas', () => {
    const text = schema('  PORT: z.coerce.number(),')
    expect(addSchemaKey(ts, text, { key: 'PORT', value: 'z.string()' }).status).toBe('exists')
    expect(addSchemaKey(ts, text, { key: 'X', value: 'z.string()', schema: 'other' }).status).toBe('unsupported')
    const notLiteral = lines('const envSchema = z.object(shape)')
    expect(addSchemaKey(ts, notLiteral, { key: 'X', value: 'z.string()' }).status).toBe('unsupported')
  })

  it('finds a non-exported schema behind a method chain', () => {
    const text = lines('const envSchema = z.object({ PORT: z.number() }).strict()')
    expect(addSchemaKey(ts, text, { key: 'HOST', value: 'z.string()' }).text).toBe(
      lines('const envSchema = z.object({ PORT: z.number(), HOST: z.string() }).strict()'),
    )
  })
})

describe('insertStatement', () => {
  const main = lines(
    "import { Miia } from '@miiajs/core'",
    '',
    'const app = new Miia()',
    '',
    '// start',
    'await app.listen(3000)',
  )
  const cors = {
    statement: 'app.use(cors())',
    exists: (sf: ts.SourceFile) => hasCall(ts, sf, 'cors'),
    before: (stmt: ts.Statement) => isListenCall(ts, stmt),
  }

  it('inserts before await app.listen(...), above its comment', () => {
    expect(insertStatement(ts, main, cors)).toEqual({
      status: 'added',
      text: lines(
        "import { Miia } from '@miiajs/core'",
        '',
        'const app = new Miia()',
        '',
        'app.use(cors())',
        '// start',
        'await app.listen(3000)',
      ),
    })
  })

  it('reports an existing call', () => {
    const text = insertStatement(ts, main, cors).text
    expect(insertStatement(ts, text, cors)).toEqual({ status: 'exists', text })
  })

  it('needs an anchor: a bootstrap() main.ts is unsupported', () => {
    const text = lines(
      'async function bootstrap() {',
      '  const app = new Miia()',
      '  await app.listen(3000)',
      '}',
      'bootstrap()',
    )
    expect(insertStatement(ts, text, cors)).toEqual({ status: 'unsupported', text })
  })

  it('isListenCall accepts listen without await and with any identifier', () => {
    const sf = ts.createSourceFile(
      'm.ts',
      'server.listen(1)\nfoo()\nawait a.b.listen(1)\n',
      ts.ScriptTarget.Latest,
      true,
    )
    expect(sf.statements.map((s) => isListenCall(ts, s))).toEqual([true, false, false])
  })
})
