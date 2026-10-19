import { afterEach, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const repoBin = fileURLToPath(new URL('../../../node_modules/.bin', import.meta.url))
const dirs: string[] = []

function project(tsconfig: object, extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'miia-build-'))
  dirs.push(root)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/main.ts'), 'export const answer: number = 42\n')
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(tsconfig))
  for (const [name, content] of Object.entries(extra)) writeFileSync(join(root, name), content)
  return root
}

const build = (cwd: string) =>
  spawnSync(process.execPath, [bin, 'build', '--runtime', 'node'], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${repoBin}${delimiter}${process.env.PATH}` },
  })

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('miia build --runtime node', () => {
  it('refuses a config with noEmit instead of reporting a build that emitted nothing', () => {
    const root = project({ compilerOptions: { noEmit: true, skipLibCheck: true }, include: ['src'] })
    const result = build(root)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('tsconfig.json sets "noEmit": true')
    expect(existsSync(join(root, 'dist'))).toBe(false)
  })

  it('compiles through tsconfig.build.json', () => {
    const root = project(
      { compilerOptions: { noEmit: true, skipLibCheck: true, types: [] }, include: ['src'] },
      {
        'tsconfig.build.json': JSON.stringify({
          extends: './tsconfig.json',
          compilerOptions: { noEmit: false, outDir: 'dist', rootDir: 'src' },
        }),
      },
    )
    const result = build(root)
    expect(result.status).toBe(0)
    expect(existsSync(join(root, 'dist/main.js'))).toBe(true)
  })
})
