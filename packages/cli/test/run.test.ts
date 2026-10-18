import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// citty's runMain calls process.exit on --help and on errors, so these run in their own process
const cli = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const createMiia = fileURLToPath(new URL('../../create-miia/src/index.ts', import.meta.url))
const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string })
  .version

const run = (file: string, args: string[]) => spawnSync(process.execPath, [file, ...args], { encoding: 'utf-8' })

describe('run', () => {
  it('miia --version prints the package version', () => {
    const result = run(cli, ['--version'])
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(version)
  })

  it('miia new --help exits with 0', () => {
    const result = run(cli, ['new', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--runtime')
  })

  it('create-miia forwards to miia new and answers --version itself', () => {
    expect(run(createMiia, ['--version']).stdout.trim()).toBe(version)
    const help = run(createMiia, ['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('miia new')
  })
})
