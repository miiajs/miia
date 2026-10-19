import type { PackageManager } from '../src/runtime/package-manager.js'
import type { Runtime } from '../src/runtime/types.js'

export interface ProbeContext {
  base: string
  /** Shared between the probes of one start step, e.g. a token from register for /auth/me */
  state: Record<string, unknown>
}

export interface Probe {
  name: string
  check: (ctx: ProbeContext) => Promise<void>
}

export type Step =
  /** A package.json script through the scenario's package manager */
  | { kind: 'run'; script: string }
  /** The project's own `miia` binary */
  | { kind: 'miia'; args: string[] }
  /** Points @miiajs/* at the packed tarballs and installs */
  | { kind: 'install' }
  /** The start script on a free PORT, polled until GET / answers, then the probes */
  | { kind: 'start'; probes: Probe[] }
  | { kind: 'shell'; command: string }

export interface Scenario {
  name: string
  runtime: Runtime
  /** Passed to `new --pm` and used to run scripts */
  pm: PackageManager
  /** Deno projects are installed with npm: `deno install` does not link bins from file: tarballs */
  installWith: 'bun' | 'npm'
  /** Extra `new` arguments */
  args?: string[]
  /** Which binary generates the project */
  via?: 'cli' | 'create-miia'
  steps: Step[]
}

export const run = (script: string): Step => ({ kind: 'run', script })
export const miia = (...args: string[]): Step => ({ kind: 'miia', args })
export const install = (): Step => ({ kind: 'install' })
export const start = (...probes: Probe[]): Step => ({ kind: 'start', probes })
export const shell = (command: string): Step => ({ kind: 'shell', command })

export function probe(
  name: string,
  request: { method?: string; path: string; body?: unknown; headers?: Record<string, string> },
  expected: {
    status: number
    json?: unknown
    contentType?: string
    header?: [string, string]
    save?: (body: unknown, state: Record<string, unknown>) => void
  },
): Probe {
  return {
    name,
    check: async ({ base, state }) => {
      const headers: Record<string, string> = { ...request.headers }
      for (const [key, value] of Object.entries(headers)) {
        headers[key] = value.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(state[k] ?? ''))
      }
      if (request.body !== undefined) headers['content-type'] = 'application/json'
      const res = await fetch(base + request.path, {
        method: request.method ?? 'GET',
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      })
      const text = await res.text()
      if (res.status !== expected.status)
        throw new Error(`${name}: status ${res.status}, expected ${expected.status}: ${text}`)
      if (expected.contentType && !res.headers.get('content-type')?.includes(expected.contentType)) {
        throw new Error(`${name}: content-type ${res.headers.get('content-type')}`)
      }
      if (expected.header) {
        const [key, value] = expected.header
        if (res.headers.get(key) !== value)
          throw new Error(`${name}: ${key} is ${res.headers.get(key)}, expected ${value}`)
      }
      const body = text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text
      if (expected.json !== undefined && JSON.stringify(body) !== JSON.stringify(expected.json)) {
        throw new Error(`${name}: body ${text}`)
      }
      expected.save?.(body, state)
    },
  }
}

const greets = probe('GET /', { path: '/' }, { status: 200, json: { message: 'Hello, Miia!' } })
const docs = probe('GET /docs/json', { path: '/docs/json' }, { status: 200, contentType: 'application/json' })
const staticIndex = probe('GET /static/', { path: '/static/' }, { status: 200, contentType: 'text/html' })
const register = probe(
  'POST /auth/register',
  { method: 'POST', path: '/auth/register', body: { email: 'e2e@example.com', password: 'e2e-password' } },
  { status: 201, save: (body, state) => (state.token = (body as { accessToken: string }).accessToken) },
)
const me = probe(
  'GET /auth/me',
  { path: '/auth/me', headers: { authorization: 'Bearer {{token}}' } },
  { status: 200, json: { id: 1, email: 'e2e@example.com' } },
)
const preflight = probe(
  'OPTIONS / (CORS)',
  { method: 'OPTIONS', path: '/', headers: { origin: 'http://example.com', 'access-control-request-method': 'GET' } },
  { status: 204, header: ['access-control-allow-origin', '*'] },
)

const createWidget = probe(
  'POST /widgets',
  { method: 'POST', path: '/widgets', body: { name: 'First' } },
  { status: 201, json: { id: 1, name: 'First' } },
)

// Every schematic, then the project must still type-check and pass its tests (the resource test included)
const generateAll: Step[] = [
  miia('g', 'resource', 'widgets'),
  miia('g', 'service', 'audit', '--export'),
  miia('g', 'guard', 'admin'),
  miia('g', 'middleware', 'timing'),
]

const basics = (runtime: Runtime): Step[] =>
  runtime === 'node' ? [run('check'), run('test'), run('build')] : [run('check'), run('test')]

const FEATURES = 'jwt-auth,swagger,cors,serve-static,rate-limit,biome'
const fullProbes = [greets, docs, staticIndex, register, me, preflight]

export const scenarios: Scenario[] = [
  {
    name: 'minimal-bun',
    runtime: 'bun',
    pm: 'bun',
    installWith: 'bun',
    steps: [install(), ...basics('bun'), ...generateAll, ...basics('bun'), start(greets, createWidget)],
  },
  {
    name: 'minimal-node',
    runtime: 'node',
    pm: 'npm',
    installWith: 'npm',
    steps: [install(), ...basics('node'), ...generateAll, ...basics('node'), start(greets, createWidget)],
  },
  {
    name: 'minimal-deno',
    runtime: 'deno',
    pm: 'deno',
    installWith: 'npm',
    steps: [
      install(),
      ...basics('deno'),
      // README points Deno users at this task: the project's own CLI, not the latest from npm
      shell('deno task miia --version'),
      ...generateAll,
      ...basics('deno'),
      start(greets, createWidget),
    ],
  },
  {
    name: 'full-bun',
    runtime: 'bun',
    pm: 'bun',
    installWith: 'bun',
    args: ['--features', FEATURES, '--db', 'drizzle-sqlite'],
    steps: [install(), ...basics('bun'), run('lint'), run('db:generate'), run('db:migrate'), start(...fullProbes)],
  },
  {
    name: 'full-node',
    runtime: 'node',
    pm: 'npm',
    installWith: 'npm',
    args: ['--features', FEATURES, '--db', 'drizzle-sqlite'],
    steps: [install(), ...basics('node'), run('db:generate'), run('db:migrate'), start(...fullProbes)],
  },
  {
    // sqlite is not available on Deno
    name: 'full-deno',
    runtime: 'deno',
    pm: 'deno',
    installWith: 'npm',
    args: ['--features', FEATURES],
    steps: [install(), ...basics('deno'), start(...fullProbes)],
  },
  // No database server here: generated code type-checks and its tests pass without one
  {
    name: 'db-postgres-bun',
    runtime: 'bun',
    pm: 'bun',
    installWith: 'bun',
    args: ['--db', 'drizzle-postgres'],
    steps: [install(), ...basics('bun'), run('db:generate')],
  },
  {
    name: 'db-mysql-bun',
    runtime: 'bun',
    pm: 'bun',
    installWith: 'bun',
    args: ['--db', 'drizzle-mysql'],
    steps: [install(), ...basics('bun'), run('db:generate')],
  },
  {
    name: 'papr-bun',
    runtime: 'bun',
    pm: 'bun',
    installWith: 'bun',
    args: ['--db', 'papr'],
    steps: [install(), ...basics('bun')],
  },
  {
    name: 'mongoose-bun',
    runtime: 'bun',
    pm: 'bun',
    installWith: 'bun',
    args: ['--db', 'mongoose'],
    steps: [install(), ...basics('bun')],
  },
  {
    name: 'create-bun',
    runtime: 'bun',
    pm: 'bun',
    installWith: 'bun',
    via: 'create-miia',
    steps: [install(), ...basics('bun')],
  },
  {
    name: 'add-bun',
    runtime: 'bun',
    pm: 'bun',
    installWith: 'bun',
    steps: [
      install(),
      miia('add', 'jwt-auth', 'swagger', '-y', '--skip-install'),
      install(),
      ...basics('bun'),
      start(greets, docs, register, me),
      shell('git init -q && git add -A && git -c user.name=e2e -c user.email=e2e@local commit -qm init'),
      miia('add', 'swagger', '-y'),
      shell('test -z "$(git status --porcelain)"'),
    ],
  },
]
