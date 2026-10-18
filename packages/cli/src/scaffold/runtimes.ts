import { updateJson } from '../codemod/json.js'
import type { ApplyContext } from './apply.js'

/** Base and runtime files are layered in one applyTemplate call; this adjusts what layering cannot. */
export function applyRuntime(ctx: ApplyContext): void {
  if (ctx.runtime === 'bun') return
  ctx.tree.update('tsconfig.json', (text) =>
    updateJson<{ compilerOptions?: { types?: string[] } }>(text, 'tsconfig.json', (config) => {
      config.compilerOptions = { ...config.compilerOptions, types: ['node'] }
    }),
  )
}
