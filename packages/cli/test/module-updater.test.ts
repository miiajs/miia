import { describe, it, expect } from 'bun:test'
import type * as t from '@babel/types'
import { parseModule, generateCode } from 'magicast'
import { addToModuleDecorator } from '../src/generate/module-updater.js'

describe('module-updater AST manipulation', () => {
  it('adds import and class to existing controllers array', () => {
    const source = `import { Module } from '@miiajs/core'
import { AppController } from './app.controller.js'

@Module({
  controllers: [AppController],
})
export class AppModule {}
`
    const mod = parseModule(source)
    mod.imports.$add({ from: './user/user.controller.js', imported: 'UserController' })
    addToModuleDecorator(mod.$ast as t.Program, 'controllers', 'UserController')
    const { code } = generateCode(mod)

    expect(code).toContain("from './user/user.controller.js'")
    expect(code).toContain('UserController')
    expect(code).toContain('UserController')
    expect(code).toContain('AppController')
  })

  it('creates a new providers array when none exists', () => {
    const source = `import { Module } from '@miiajs/core'

@Module({
  controllers: [AppController],
})
export class AppModule {}
`
    const mod = parseModule(source)
    addToModuleDecorator(mod.$ast as t.Program, 'providers', 'UserService')
    const { code } = generateCode(mod)

    expect(code).toContain('providers')
    expect(code).toContain('UserService')
  })

  it('does not duplicate an existing entry', () => {
    const source = `import { Module } from '@miiajs/core'
import { UserController } from './user/user.controller.js'

@Module({
  controllers: [UserController],
})
export class AppModule {}
`
    const mod = parseModule(source)
    addToModuleDecorator(mod.$ast as t.Program, 'controllers', 'UserController')
    const { code } = generateCode(mod)

    const matches = code.match(/UserController/g)
    // Once in import, once in array - not duplicated in array
    expect(matches?.length).toBe(2)
  })

  it('handles empty @Module({})', () => {
    const source = `import { Module } from '@miiajs/core'

@Module({})
export class UserModule {}
`
    const mod = parseModule(source)
    addToModuleDecorator(mod.$ast as t.Program, 'imports', 'DrizzleModule')
    const { code } = generateCode(mod)

    expect(code).toContain('imports')
    expect(code).toContain('DrizzleModule')
  })

  it('works with export class (ExportNamedDeclaration)', () => {
    const source = `import { Module } from '@miiajs/core'

@Module({
  providers: [],
})
export class AppModule {}
`
    const mod = parseModule(source)
    const result = addToModuleDecorator(mod.$ast as t.Program, 'providers', 'AuthService')
    const { code } = generateCode(mod)

    expect(result).toBe(true)
    expect(code).toContain('AuthService')
  })
})
