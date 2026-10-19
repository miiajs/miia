import { afterEach, describe, expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const dirs: string[] = []

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'miia-start-'))
  dirs.push(root)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
  return root
}

function runCli(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const child = spawn(process.execPath, [bin, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)))
  const waitFor = async (text: string) => {
    while (!output.includes(text)) await Bun.sleep(20)
  }
  return { child, exited, waitFor, output: () => output }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('miia start', () => {
  it('exits with the code of the app', async () => {
    const cwd = fixture({ 'main.ts': 'process.exit(42)\n' })
    const run = runCli(cwd, ['start', '--runtime', 'bun', '--entry', 'main.ts'])
    expect(await run.exited).toBe(42)
  })

  it(
    'forwards SIGTERM and waits for a graceful shutdown past execa 5s force-kill',
    async () => {
      const cwd = fixture({
        'main.ts': [
          "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 7000))",
          "console.log('app ready')",
          'setInterval(() => {}, 1000)',
          '',
        ].join('\n'),
      })
      const run = runCli(cwd, ['start', '--runtime', 'bun', '--entry', 'main.ts'])
      await run.waitFor('app ready')
      const started = Date.now()
      run.child.kill('SIGTERM')
      // A clean shutdown after a forwarded SIGTERM reports the signal
      expect(await run.exited).toBe(143)
      expect(Date.now() - started).toBeGreaterThanOrEqual(6500)
    },
    { timeout: 20_000 },
  )

  it('lets a non-zero exit code of the app win over the signal', async () => {
    const cwd = fixture({
      'main.ts': [
        "process.on('SIGTERM', () => process.exit(3))",
        "console.log('app ready')",
        'setInterval(() => {}, 1000)',
        '',
      ].join('\n'),
    })
    const run = runCli(cwd, ['start', '--runtime', 'bun', '--entry', 'main.ts'])
    await run.waitFor('app ready')
    run.child.kill('SIGINT')
    expect(await run.exited).toBe(3)
  })

  it('fails with a message when the runtime is missing', async () => {
    const cwd = fixture({ 'main.ts': '' })
    const pathDir = join(cwd, 'bin')
    mkdirSync(pathDir)
    symlinkSync(process.execPath, join(pathDir, 'bun'))
    const run = runCli(cwd, ['start', '--runtime', 'deno', '--entry', 'main.ts'], { ...process.env, PATH: pathDir })
    expect(await run.exited).toBe(1)
    expect(run.output()).toContain('Runtime "deno" not found in PATH')
  })
})
