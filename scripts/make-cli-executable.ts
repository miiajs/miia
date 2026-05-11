import { chmodSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const binPath = join(root, 'packages/cli/dist/bin.js')

chmodSync(binPath, 0o755)

console.log('cli bin marked executable')
