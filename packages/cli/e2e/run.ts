/**
 * Generates projects outside the repo against the packed packages and runs them for real:
 * install, check, tests, build, start and HTTP probes on Bun, Node.js and Deno.
 *
 *   bun run cli:e2e [--only a,b] [--keep]
 *
 * Needs bun, node, deno and network access (third-party packages come from the registry).
 */
import { type ChildProcess, spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runScriptCommand } from '../src/runtime/package-manager.js'
import { type Scenario, type Step, scenarios } from './scenarios.js'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const onlyIndex = argv.indexOf('--only')
const only = onlyIndex === -1 ? null : (argv[onlyIndex + 1] ?? '').split(',').filter(Boolean)

const work = mkdtempSync(join(tmpdir(), 'miia-e2e-'))
const tarballDir = join(work, 'tarballs')
const projectsDir = join(work, 'projects')
const logsDir = join(work, 'logs')
for (const dir of [tarballDir, projectsDir, logsDir]) mkdirSync(dir, { recursive: true })

type Outcome = 'ok' | 'FAIL' | 'skip'
const results: Array<{ scenario: string; steps: Array<[string, Outcome]> }> = []

async function exec(command: string, opts: { cwd: string; log: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  const out = createWriteStream(opts.log, { flags: 'a' })
  out.write(`$ ${command}\n`)
  const child = spawn(command, {
    cwd: opts.cwd,
    shell: true,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(out, { end: false })
  child.stderr?.pipe(out, { end: false })
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
  out.end()
  if (code !== 0) throw new Error(`"${command}" exited with ${code}`)
}

function tail(file: string, lines = 40): string {
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf-8').split('\n').slice(-lines).join('\n')
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port')),
      )
    })
  })
}

async function stopTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const kill = (signal: NodeJS.Signals) => {
    try {
      process.kill(-(child.pid as number), signal)
    } catch {}
  }
  kill('SIGTERM')
  const timer = setTimeout(() => kill('SIGKILL'), 10_000)
  await exited
  clearTimeout(timer)
}

// --- packages ----------------------------------------------------------------

const tarballs = new Map<string, string>()

async function packPackages(): Promise<void> {
  const log = join(logsDir, 'pack.log')
  // A clean dist: tsc --build leaves outputs of deleted sources behind, and they would be packed
  await exec('bun run clean:dist && bun run build', { cwd: repo, log })
  for (const entry of readdirSync(join(repo, 'packages'))) {
    const dir = join(repo, 'packages', entry)
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, 'utf-8')) as { name: string; version: string; private?: boolean }
    if (pkg.private) continue
    await exec(`bun pm pack --destination "${tarballDir}"`, { cwd: dir, log })
    const file = join(tarballDir, `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`)
    if (!existsSync(file)) throw new Error(`tarball for ${pkg.name} not found: ${file}`)
    tarballs.set(pkg.name, file)
  }

  const cli = tarballs.get('@miiajs/cli') as string
  const listing = join(logsDir, 'cli-tarball.txt')
  await exec(`tar -tzf "${cli}" > "${listing}"`, { cwd: work, log })
  const entries = readFileSync(listing, 'utf-8').split('\n')
  const must = [
    'package/templates/base/files/_gitignore',
    'package/templates/base/manifest.json',
    'package/dist/bin.js',
  ]
  for (const path of must) if (!entries.includes(path)) throw new Error(`CLI tarball lacks ${path}`)
  const mustNot = ['package/templates/package.json', 'package/templates/tsconfig.json']
  for (const path of mustNot) if (entries.includes(path)) throw new Error(`CLI tarball contains ${path}`)
  if (entries.some((e) => e.startsWith('package/templates/node_modules/')))
    throw new Error('CLI tarball contains templates/node_modules')

  // npm runs create-miia through its bin: the executable bit must survive packing
  const create = tarballs.get('create-miia') as string
  const createListing = join(logsDir, 'create-miia-tarball.txt')
  await exec(`tar -tvzf "${create}" > "${createListing}"`, { cwd: work, log })
  const bin = readFileSync(createListing, 'utf-8')
    .split('\n')
    .find((line) => line.endsWith('package/dist/index.js'))
  if (!bin?.startsWith('-rwx')) throw new Error(`create-miia bin is not executable in the tarball: ${bin}`)
}

function pointAtTarballs(projectDir: string): void {
  const file = join(projectDir, 'package.json')
  const pkg = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, Record<string, string> | unknown>
  const mapping = Object.fromEntries([...tarballs].map(([name, path]) => [name, `file:${path}`]))
  for (const kind of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[kind] as Record<string, string> | undefined
    for (const name of Object.keys(deps ?? {}))
      if (mapping[name]) (deps as Record<string, string>)[name] = mapping[name]
  }
  // Transitive @miiajs/* (swagger -> serve-static) resolve to the tarballs too
  pkg.overrides = mapping
  pkg.pnpm = { overrides: mapping }
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
}

// --- scenarios -----------------------------------------------------------------

function stepName(step: Step): string {
  switch (step.kind) {
    case 'run':
      return step.script
    case 'miia':
      return `miia ${step.args.join(' ')}`
    case 'install':
      return 'install'
    case 'start':
      return 'start'
    case 'shell':
      return step.command.split(' ').slice(0, 2).join(' ')
  }
}

async function runStep(scenario: Scenario, step: Step, projectDir: string, log: string): Promise<void> {
  switch (step.kind) {
    case 'run':
      return exec(runScriptCommand(scenario.pm, step.script), { cwd: projectDir, log })
    case 'miia':
      return exec(`"${join(projectDir, 'node_modules', '.bin', 'miia')}" ${step.args.join(' ')}`, {
        cwd: projectDir,
        log,
      })
    case 'shell':
      return exec(step.command, { cwd: projectDir, log })
    case 'install':
      pointAtTarballs(projectDir)
      return exec(`${scenario.installWith} install`, { cwd: projectDir, log })
    case 'start':
      return startAndProbe(scenario, step.probes, projectDir, log)
  }
}

async function startAndProbe(
  scenario: Scenario,
  probes: Extract<Step, { kind: 'start' }>['probes'],
  projectDir: string,
  log: string,
): Promise<void> {
  const port = await freePort()
  const out = createWriteStream(log, { flags: 'a' })
  const command = runScriptCommand(scenario.pm, 'start')
  out.write(`$ PORT=${port} ${command}\n`)
  const child = spawn(command, {
    cwd: projectDir,
    shell: true,
    detached: true,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(out, { end: false })
  child.stderr?.pipe(out, { end: false })
  const base = `http://127.0.0.1:${port}`
  try {
    const deadline = Date.now() + 30_000
    while (true) {
      if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`)
      try {
        const res = await fetch(`${base}/`)
        if (res.status === 200) break
      } catch {}
      if (Date.now() > deadline) throw new Error('server did not answer GET / within 30s')
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const state: Record<string, unknown> = {}
    for (const probe of probes) {
      await probe.check({ base, state })
      out.write(`probe ok: ${probe.name}\n`)
    }
  } finally {
    await stopTree(child)
    out.end()
  }
}

async function runScenario(scenario: Scenario): Promise<boolean> {
  const steps: Array<[string, Outcome]> = []
  results.push({ scenario: scenario.name, steps })
  const projectName = `app-${scenario.name}`
  const projectDir = join(projectsDir, projectName)
  const log = join(logsDir, `${scenario.name}.log`)

  const generator =
    scenario.via === 'create-miia'
      ? join(repo, 'packages', 'create-miia', 'dist', 'index.js')
      : join(repo, 'packages', 'cli', 'dist', 'bin.js')
  const newArgs = scenario.via === 'create-miia' ? [projectName] : ['new', projectName]
  const generate = [
    'node',
    `"${generator}"`,
    ...newArgs,
    '--runtime',
    scenario.runtime,
    '--pm',
    scenario.pm,
    ...(scenario.args ?? []),
    '-y',
    '--skip-install',
  ].join(' ')

  const all: Array<[string, () => Promise<void>]> = [
    ['new', () => exec(generate, { cwd: projectsDir, log })],
    ...scenario.steps.map((step): [string, () => Promise<void>] => [
      stepName(step),
      () => runStep(scenario, step, projectDir, log),
    ]),
  ]

  let failed = false
  for (const [name, fn] of all) {
    if (failed) {
      steps.push([name, 'skip'])
      continue
    }
    const started = Date.now()
    process.stdout.write(`[${scenario.name}] ${name} ... `)
    try {
      await fn()
      steps.push([name, 'ok'])
      console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s)`)
    } catch (err) {
      failed = true
      steps.push([name, 'FAIL'])
      console.log(`FAIL\n  ${(err as Error).message}\n--- ${log} (tail)\n${tail(log)}\n---`)
    }
  }
  return !failed
}

// --- main ------------------------------------------------------------------------

const selected = only ? scenarios.filter((s) => only.includes(s.name)) : scenarios
if (only && selected.length !== only.length) {
  const known = scenarios.map((s) => s.name).join(', ')
  console.error(`Unknown scenario in --only. Known: ${known}`)
  process.exit(2)
}

console.log(`e2e work dir: ${work}`)
let ok = true
try {
  process.stdout.write('[setup] build and pack ... ')
  await packPackages()
  console.log('ok')
  for (const scenario of selected) ok = (await runScenario(scenario)) && ok
} catch (err) {
  ok = false
  console.log(`FAIL\n  ${(err as Error).message}\n${tail(join(logsDir, 'pack.log'))}`)
}

console.log('\nSummary')
for (const { scenario, steps } of results) {
  console.log(`  ${scenario.padEnd(20)} ${steps.map(([name, outcome]) => `${name}:${outcome}`).join('  ')}`)
}
if (keep || !ok) console.log(`\nKept ${work}`)
else rmSync(work, { recursive: true, force: true })
process.exit(ok ? 0 : 1)
