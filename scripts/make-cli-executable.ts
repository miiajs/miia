import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const binPath = join(root, 'packages/cli/dist/bin.js')

chmodSync(binPath, 0o755)

console.log('cli bin marked executable')
