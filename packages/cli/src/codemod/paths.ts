import { posix } from 'node:path'

/** ESM specifier from one project file to another: posix, relative, `.ts` -> `.js`. */
export function importSpecifier(fromFile: string, toFile: string): string {
  const from = fromFile.replaceAll('\\', '/')
  const to = toFile.replaceAll('\\', '/')
  const rel = posix
    .relative(posix.dirname(from), to)
    .replace(/\.ts$/, '.js')
    .replace(/\.mts$/, '.mjs')
  return rel.startsWith('.') ? rel : `./${rel}`
}
