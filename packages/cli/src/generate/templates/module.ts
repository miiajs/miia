import type { GenerateContext } from '../types.js'

export function moduleTemplate(ctx: GenerateContext): string {
  return `import { Module } from '@miiajs/core'

@Module({})
export class ${ctx.className}Module {}
`
}
