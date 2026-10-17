import { importSpecifier } from '../codemod/paths.js'
import { addImport, addToModuleArray, type EditStatus, type ModuleKey } from '../codemod/source.js'
import type { ProjectTree } from '../codemod/tree.js'
import type { TS } from '../codemod/typescript.js'

/**
 * Adds `className` (exported from `file`) to `key` of the @Module in `modulePath`, plus its import.
 * The array goes first: an import without the array entry would be left unused. A name clash on the
 * import leaves the module untouched and returns 'conflict'.
 */
export function registerInModule(
  tree: ProjectTree,
  ts: TS,
  opts: { modulePath: string; className: string; file: string; key: ModuleKey },
): EditStatus {
  let status: EditStatus = 'unsupported'
  tree.update(opts.modulePath, (text) => {
    const array = addToModuleArray(ts, text, { key: opts.key, element: opts.className, ref: opts.className })
    status = array.status
    if (array.status !== 'added') return text
    const imported = addImport(ts, array.text, {
      from: importSpecifier(opts.modulePath, opts.file),
      names: [opts.className],
    })
    if (imported.status === 'conflict') {
      status = 'conflict'
      return text
    }
    return imported.text
  })
  return status
}
