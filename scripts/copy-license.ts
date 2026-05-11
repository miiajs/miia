import { copyFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const licenseSrc = join(root, 'LICENSE')
const packagesDir = join(root, 'packages')

let copied = 0
for (const entry of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, entry)
  if (!statSync(pkgDir).isDirectory()) continue
  copyFileSync(licenseSrc, join(pkgDir, 'LICENSE'))
  copied++
}

console.log(`LICENSE copied to ${copied} packages`)
