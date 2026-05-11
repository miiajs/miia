import type { GenerateContext } from '../types.js'

export function guardTemplate(ctx: GenerateContext): string {
  return `import { Injectable } from '@miiajs/core'
import type { CanActivate, RequestContext } from '@miiajs/core'

@Injectable()
export class ${ctx.className}Guard implements CanActivate {
  canActivate(ctx: RequestContext): boolean {
    return true
  }
}
`
}
