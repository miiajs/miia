import type { Runtime } from '../runtime/types.js'
import type { Feature } from './types.js'

interface ComposeContext {
  runtime: Runtime
  features: Feature[]
}

export function composeAppModule(ctx: ComposeContext): string {
  const imports: string[] = [`import { Module } from '@miiajs/core'`]
  const moduleImports: string[] = []

  const hasConfigService = ctx.features.some((f) => f.moduleImport?.entries.some((e) => e.includes('ConfigService')))

  for (const feature of ctx.features) {
    if (feature.moduleImport) {
      imports.push(feature.moduleImport.statement)
      for (const entry of feature.moduleImport.entries) {
        moduleImports.push(entry)
      }
    }
  }

  // Add ConfigService import if any feature uses resolve(ConfigService)
  if (hasConfigService) {
    imports.push(`import { ConfigService } from '@miiajs/config'`)
  }

  // Always include AppController + AppService (sibling files in app/)
  imports.push(`import { AppController } from './app.controller.js'`)
  imports.push(`import { AppService } from './app.service.js'`)

  const moduleBlock = moduleImports.length > 0 ? `  imports: [\n    ${moduleImports.join(',\n    ')},\n  ],\n` : ''

  return `${imports.join('\n')}

@Module({
${moduleBlock}  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`
}

export function composeMainTs(ctx: ComposeContext): string {
  const imports: string[] = [`import { Miia } from '@miiajs/core'`]
  const codeBeforeListen: string[] = []

  // Feature main.ts contributions
  for (const feature of ctx.features) {
    if (feature.mainSetup) {
      imports.push(...feature.mainSetup.imports)
      codeBeforeListen.push(...feature.mainSetup.code)
    }
  }

  imports.push(`import { AppModule } from './app/app.module.js'`)

  const hasConfig = ctx.features.some((f) => f.id === 'config')
  if (hasConfig) {
    imports.push(`import { ConfigService } from '@miiajs/config'`)
    imports.push(`import type { Env } from './env.schema.js'`)
  }

  const lines: string[] = [...imports, '']

  lines.push(`const app = new Miia()`)
  lines.push(`  .register(AppModule)`)
  lines.push('')

  // Insert feature code before listen
  if (codeBeforeListen.length > 0) {
    lines.push(...codeBeforeListen)
    lines.push('')
  }

  let portExpr = '3000'
  let hostExpr = `'0.0.0.0'`
  if (hasConfig) {
    lines.push(`const configService = app.get(ConfigService<Env>)`)
    lines.push(`const port = configService.get('PORT')`)
    lines.push(`const host = configService.get('HOST')`)
    lines.push('')
    portExpr = 'port'
    hostExpr = 'host'
  }

  // Runtime-specific listen
  if (ctx.runtime === 'node') {
    lines.push(`const { serve } = await import('@miiajs/node-server')`)
    lines.push(`await app.listen(${portExpr}, ${hostExpr}, serve)`)
  } else {
    lines.push(`await app.listen(${portExpr}, ${hostExpr})`)
  }

  lines.push('')
  return lines.join('\n')
}

export function composeAppController(): string {
  return `import { Controller, Get, inject } from '@miiajs/core'
import { AppService } from './app.service.js'

@Controller()
export class AppController {
  private appService = inject(AppService)

  @Get('/')
  hello() {
    return { message: this.appService.getHello() }
  }
}
`
}

export function composeAppService(): string {
  return `import { Injectable } from '@miiajs/core'

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello, Miia!'
  }
}
`
}
