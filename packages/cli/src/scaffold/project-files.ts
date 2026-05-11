import type { Runtime } from '../runtime/types.js'
import type { Feature } from './types.js'

interface ProjectFilesContext {
  name: string
  runtime: Runtime
  features: Feature[]
}

export function buildPackageJson(ctx: ProjectFilesContext): string {
  const deps: Record<string, string> = {
    '@miiajs/core': '^0.1.0',
  }
  const devDeps: Record<string, string> = {
    '@miiajs/cli': '^0.1.0',
    typescript: '^6.0.2',
  }

  if (ctx.runtime === 'node') {
    deps['@miiajs/node-server'] = '^0.1.0'
    devDeps['tsx'] = '^4.19.0'
  }

  // Merge feature dependencies
  for (const feature of ctx.features) {
    Object.assign(deps, feature.packages)
    if (feature.devPackages) Object.assign(devDeps, feature.devPackages)
  }

  return (
    JSON.stringify(
      {
        name: ctx.name,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'miia dev',
          build: 'miia build',
          start: 'miia start',
          check: 'miia check',
        },
        dependencies: sortObject(deps),
        devDependencies: sortObject(devDeps),
      },
      null,
      2,
    ) + '\n'
  )
}

export function buildTsconfig(runtime: Runtime): string {
  const base: Record<string, unknown> = {
    target: 'ES2025',
    module: 'nodenext',
    strict: true,
    skipLibCheck: true,
    verbatimModuleSyntax: true,
  }

  if (runtime === 'node') {
    Object.assign(base, {
      outDir: './dist',
      rootDir: './src',
      declaration: true,
      sourceMap: true,
    })
  } else {
    base.noEmit = true
  }

  return (
    JSON.stringify(
      {
        compilerOptions: base,
        include: ['src'],
      },
      null,
      2,
    ) + '\n'
  )
}

export function buildGitignore(): string {
  return `node_modules/
dist/
*.tsbuildinfo
.env
`
}

export function buildEnvFile(features: Feature[]): string {
  const vars: Record<string, string> = {}
  for (const feature of features) {
    if (feature.envVars) Object.assign(vars, feature.envVars)
  }
  return (
    Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n'
  )
}

function sortObject(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
}
