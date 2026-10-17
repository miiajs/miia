import type { SourceFile } from 'typescript'
import { addDevHint, detectPackageManager } from '../runtime/package-manager.js'
import { CliError } from '../utils/errors.js'

export type TS = typeof import('typescript')

let loading: Promise<TS> | undefined

// Peer dependency: the project's own TypeScript, loaded only by commands that edit code
export function loadTypeScript(): Promise<TS> {
  loading ??= import('typescript').then(
    (mod) => ((mod as { default?: TS }).default ?? mod) as TS,
    () => {
      loading = undefined
      const hint = addDevHint(detectPackageManager(process.cwd()) ?? 'npm', 'typescript')
      throw new CliError(`TypeScript is required to edit project files. Install it:\n  ${hint}`)
    },
  )
  return loading
}

export function parse(ts: TS, text: string, fileName = 'file.ts'): SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}
