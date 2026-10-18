import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
chmodSync(join(root, 'packages/cli/dist/bin.js'), 0o755)
chmodSync(join(root, 'packages/create-miia/dist/index.js'), 0o755)

console.log('cli bin marked executable')
