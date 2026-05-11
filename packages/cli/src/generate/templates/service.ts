import type { GenerateContext } from '../types.js'

export function serviceTemplate(ctx: GenerateContext): string {
  return `import { Injectable } from '@miiajs/core'

@Injectable()
export class ${ctx.className}Service {
  findAll() {
    return []
  }
}
`
}
