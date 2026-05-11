import type { GenerateContext } from '../types.js'
import { lowerFirst } from '../../utils/naming.js'

export function middlewareTemplate(ctx: GenerateContext): string {
  const fnName = `${lowerFirst(ctx.className)}Middleware`
  return `import type { Middleware } from '@miiajs/core'

export const ${fnName}: Middleware = async (ctx, next) => {
  await next()
}
`
}
