import type { GenerateContext } from '../types.js'

export function controllerTemplate(ctx: GenerateContext): string {
  return `import { Controller, Get } from '@miiajs/core'
import type { RequestContext } from '@miiajs/core'

@Controller('/${ctx.fileName}')
export class ${ctx.className}Controller {
  @Get()
  findAll(ctx: RequestContext) {
    return []
  }
}
`
}
