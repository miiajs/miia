import module from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// oven-sh/bun#41151: the default Error.prepareStackTrace throws for objects that are not errors;
// babel inside jiti delegates to it, and vite calls Error.captureStackTrace on such an object
try {
  Error.prepareStackTrace?.({}, [])
} catch {
  Error.prepareStackTrace = undefined
}

// oven-sh/bun#23898: node:module has no findPackageJSON; nuxt-og-image and nuxtseo-shared call it.
// It reaches them only because jiti transforms a module whose native import fails
if (typeof module.findPackageJSON !== 'function') {
  const toPath = p => (String(p).startsWith('file:') ? fileURLToPath(p) : String(p))
  const walkUp = (dir, rel) => {
    for (;;) {
      if (existsSync(join(dir, rel))) return join(dir, rel)
      if (dirname(dir) === dir) return undefined
      dir = dirname(dir)
    }
  }
  module.findPackageJSON = (specifier, base) => {
    const spec = toPath(specifier)
    if (spec.startsWith('.') || spec.startsWith('/')) return walkUp(resolve(dirname(toPath(base)), spec), 'package.json')
    const name = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')
    const file = walkUp(dirname(toPath(base)), join('node_modules', name, 'package.json'))
    if (file) return file
    throw Object.assign(new Error(`Cannot find package '${name}'`), { code: 'ERR_MODULE_NOT_FOUND' })
  }
}
