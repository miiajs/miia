import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Runtime } from '../src/runtime/types.js'
import { addons } from '../src/scaffold/addons.js'
import { flavorOf } from '../src/scaffold/apply.js'
import { type Manifest, overlayManifest, readManifest, templatesDir } from '../src/scaffold/templates.js'

interface Pkg {
  name: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const packagesDir = join(templatesDir, '..', '..')
const repoPackages = new Map<string, Pkg>()
for (const entry of readdirSync(packagesDir)) {
  const file = join(packagesDir, entry, 'package.json')
  if (existsSync(file)) {
    const pkg = JSON.parse(readFileSync(file, 'utf-8')) as Pkg
    repoPackages.set(pkg.name, pkg)
  }
}

function manifestFiles(dir = templatesDir): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry.startsWith('files')) return []
    const path = join(dir, entry)
    if (/^manifest(-\w+)?\.json$/.test(entry)) return [path]
    return statSync(path).isDirectory() ? manifestFiles(path) : []
  })
}

const FULL_RANGE = /^\^\d+\.\d+\.\d+$/
const allDeps = (m: Manifest) => ({ ...m.dependencies, ...m.devDependencies })

const runtimes: Runtime[] = ['bun', 'node', 'deno']
const chains = runtimes.flatMap((runtime) => [
  { label: runtime, dirs: ['base', `runtimes/${runtime}`], runtime },
  ...addons
    .filter((a) => !a.runtimes || a.runtimes.includes(runtime))
    .map((a) => ({ label: `${runtime} + ${a.id}`, dirs: ['base', `runtimes/${runtime}`, `addons/${a.id}`], runtime })),
])

function chainManifest(dirs: string[], runtime: Runtime): Manifest {
  return dirs
    .map((dir) => readManifest(dir, flavorOf(runtime)))
    .reduce<Manifest>((acc, m) => (m ? overlayManifest(acc, m) : acc), {})
}

describe('template manifests', () => {
  const files = manifestFiles()
  const templatesPkg = JSON.parse(readFileSync(join(templatesDir, 'package.json'), 'utf-8')) as Pkg

  it('use full ^X.Y.Z ranges and workspace:* for @miiajs packages that exist', () => {
    expect(files.map((f) => f.slice(templatesDir.length))).toContain('addons/drizzle-sqlite/manifest-node.json')
    for (const file of [...files, join(templatesDir, 'package.json')]) {
      const manifest = JSON.parse(readFileSync(file, 'utf-8')) as Manifest
      for (const [name, range] of Object.entries(allDeps(manifest))) {
        if (name.startsWith('@miiajs/')) {
          expect({ file, name, range }).toEqual({ file, name, range: 'workspace:*' })
          expect(repoPackages.has(name)).toBe(true)
        } else {
          expect({ file, name, range: FULL_RANGE.test(range) }).toEqual({ file, name, range: true })
        }
      }
    }
  })

  it('bring every required peer of the @miiajs packages they use', () => {
    for (const chain of chains) {
      const deps = allDeps(chainManifest(chain.dirs, chain.runtime))
      const seen = new Set<string>()
      const visit = (name: string) => {
        if (seen.has(name)) return
        seen.add(name)
        const pkg = repoPackages.get(name) as Pkg
        for (const dep of Object.keys(pkg.dependencies ?? {})) if (dep.startsWith('@miiajs/')) visit(dep)
        for (const peer of Object.keys(pkg.peerDependencies ?? {})) {
          if (peer.startsWith('@miiajs/') || pkg.peerDependenciesMeta?.[peer]?.optional) continue
          expect({ chain: chain.label, via: name, peer, present: peer in deps }).toEqual({
            chain: chain.label,
            via: name,
            peer,
            present: true,
          })
        }
      }
      for (const name of Object.keys(deps)) if (name.startsWith('@miiajs/')) visit(name)
    }
  })

  it('pick versions inside the peer ranges of the repo packages', () => {
    for (const file of files) {
      const manifest = JSON.parse(readFileSync(file, 'utf-8')) as Manifest
      for (const [name, range] of Object.entries(allDeps(manifest))) {
        if (name.startsWith('@miiajs/')) continue
        for (const pkg of repoPackages.values()) {
          const peerRange = pkg.peerDependencies?.[name]
          if (!peerRange) continue
          expect({ file, name, range, peer: pkg.name, ok: Bun.semver.satisfies(range.slice(1), peerRange) }).toEqual({
            file,
            name,
            range,
            peer: pkg.name,
            ok: true,
          })
        }
      }
    }
  })

  it('match the templates workspace, so the IDE sees the versions users get', () => {
    const expected: Record<string, string> = {}
    for (const file of files) {
      const manifest = JSON.parse(readFileSync(file, 'utf-8')) as Manifest
      for (const [name, range] of Object.entries(allDeps(manifest))) if (name !== '@miiajs/cli') expected[name] = range
    }
    expect(templatesPkg.devDependencies).toEqual(expected)
  })
})
