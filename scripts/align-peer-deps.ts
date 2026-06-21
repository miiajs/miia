import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Align internal `@miiajs/*` peerDependency ranges to the freshly released
// version. Run AFTER `changeset version` and before `bun install`.
//
// Why this exists: every @miiajs package is one `fixed` changesets group
// (lockstep until 1.0). To stop a `minor` core bump from force-major-bumping
// every peer dependent, the changeset config sets
// `onlyUpdatePeerDependentsWhenOutOfRange: true` with a wide peer range
// (`>=x.y.0 <1.0.0`). The side effect: changesets then never touches the peer
// range, so its floor would otherwise stay frozen at the original version even
// though the new packages require the new core APIs. This script re-floors it.
//
// Regular `dependencies` are left alone - changesets already bumps those.

const root = new URL('..', import.meta.url).pathname
const packagesDir = join(root, 'packages')

// Source of truth for the lockstep version: @miiajs/core.
const corePkg = JSON.parse(readFileSync(join(packagesDir, 'core', 'package.json'), 'utf8'))
const version: string = corePkg.version
const [major, minor] = version.split('-')[0].split('.')

// 0.x-only helper. Past 1.0 the lockstep strategy is dropped (packages diverge
// onto per-package `^x` ranges), so refuse rather than write a nonsense range.
if (major !== '0') {
  console.log(`align-peer-deps: core is ${version} (>= 1.0.0) - lockstep helper is 0.x-only, skipping.`)
  process.exit(0)
}

const range = `>=${major}.${minor}.0 <1.0.0`

let updatedFiles = 0
let updatedRanges = 0
for (const entry of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, entry, 'package.json')
  if (!statSync(join(packagesDir, entry)).isDirectory()) continue

  const raw = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(raw)
  const peers = pkg.peerDependencies
  if (!peers) continue

  let changed = false
  for (const name of Object.keys(peers)) {
    if (!name.startsWith('@miiajs/')) continue
    if (peers[name] !== range) {
      peers[name] = range
      changed = true
      updatedRanges++
    }
  }

  if (changed) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    updatedFiles++
  }
}

console.log(`align-peer-deps: set ${updatedRanges} @miiajs/* peer range(s) to "${range}" across ${updatedFiles} package(s)`)
