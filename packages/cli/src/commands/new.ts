import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import type { PackageJson } from '../codemod/json.js'
import { ProjectTree } from '../codemod/tree.js'
import { loadTypeScript } from '../codemod/typescript.js'
import { runScriptCommand } from '../runtime/package-manager.js'
import { type ApplyContext, flavorOf } from '../scaffold/apply.js'
import { createProject } from '../scaffold/create.js'
import { install } from '../scaffold/install.js'
import { resolveNewOptions } from '../scaffold/options.js'
import { action } from '../utils/errors.js'
import { formatFiles } from '../utils/format.js'
import { logger } from '../utils/logger.js'
import { cliVersion } from '../utils/package-info.js'
import { findExecutable } from '../utils/which.js'

export default defineCommand({
  meta: {
    name: 'new',
    description: 'Create a new MiiaJS project',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Project name (npm package name), or "." for the current folder',
      required: false,
    },
    runtime: {
      type: 'string',
      description: 'Runtime: bun, node, deno (default: bun when installed, else node)',
      alias: 'r',
    },
    pm: {
      type: 'string',
      description: 'Package manager: bun, npm, pnpm, yarn, deno',
    },
    features: {
      type: 'string',
      description: 'Comma-separated add-ons, e.g. jwt-auth,swagger',
    },
    db: {
      type: 'string',
      description: 'Database add-on, or "none"',
    },
    yes: {
      type: 'boolean',
      description: 'Use defaults instead of prompts',
      alias: 'y',
      default: false,
    },
    'skip-install': {
      type: 'boolean',
      description: 'Skip dependency installation',
      default: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print the files that would be created without writing them',
      default: false,
    },
  },
  run: action(async ({ args }) => {
    const interactive = !args.yes && !!process.stdin.isTTY
    if (interactive) p.intro('Create a new MiiaJS app')

    const options = await resolveNewOptions(args, {
      interactive,
      hasBun: findExecutable('bun') !== null,
      userAgent: process.env.npm_config_user_agent,
    })
    if (!options) return

    const ctx: ApplyContext = {
      tree: new ProjectTree(options.dir),
      ts: await loadTypeScript(),
      runtime: options.runtime,
      flavor: flavorOf(options.runtime),
      projectName: options.name,
      cliVersion: cliVersion(),
      random: (bytes) => randomBytes(bytes).toString('hex'),
    }
    const { warnings } = createProject(ctx, options)
    const shownDir = relative(process.cwd(), options.dir) || '.'

    if (options.dryRun) {
      logger.info(`DRY RUN - nothing is written to ${shownDir}\n`)
      for (const line of ctx.tree.summary()) logger.info(`  ${line}`)
      const pkg = JSON.parse(ctx.tree.read('package.json') ?? '{}') as PackageJson
      logger.info('\n  Dependencies:')
      for (const [name, range] of Object.entries(pkg.dependencies ?? {})) logger.info(`    ${name} ${range}`)
      for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) logger.info(`    ${name} ${range} (dev)`)
      for (const warning of new Set(warnings)) logger.warn(warning)
      return
    }

    const written = await ctx.tree.commit()
    for (const line of ctx.tree.summary()) logger.success(`  ${line}`)

    if (options.install) {
      logger.info(`\nInstalling dependencies with ${options.packageManager}...`)
      await install(options.packageManager, options.dir)
      if (existsSync(join(options.dir, 'biome.json'))) await formatFiles(written, options.dir)
    }
    for (const warning of new Set(warnings)) logger.warn(warning)

    const steps = [
      shownDir === '.' ? null : `cd ${shownDir}`,
      options.install ? null : `${options.packageManager} install`,
      runScriptCommand(options.packageManager, 'dev'),
    ].filter(Boolean)
    const next = `Project "${options.name}" created. Next:\n\n  ${steps.join('\n  ')}`
    if (interactive) p.outro(next)
    else logger.success(`\n${next}`)
  }),
})
