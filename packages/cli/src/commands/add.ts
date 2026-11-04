import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { execa } from 'execa'
import type { PackageJson } from '../codemod/json.js'
import { loadTypeScript } from '../codemod/typescript.js'
import { addToProject, dependencySnapshot, openProject } from '../scaffold/add.js'
import { availableAddons } from '../scaffold/addons.js'
import { install } from '../scaffold/install.js'
import { action, CliError } from '../utils/errors.js'
import { formatFiles } from '../utils/format.js'
import { logger } from '../utils/logger.js'
import { cliVersion } from '../utils/package-info.js'

export default defineCommand({
  meta: {
    name: 'add',
    description: 'Add features to an existing project',
  },
  args: {
    addons: {
      type: 'positional',
      description: 'Add-ons: jwt-auth, swagger, cors, serve-static, rate-limit, biome, drizzle-postgres, ...',
      required: false,
    },
    yes: {
      type: 'boolean',
      description: 'Do not ask (dirty git tree)',
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
      description: 'Print the changes without writing them',
      default: false,
    },
  },
  run: action(async ({ args }) => {
    const cwd = process.cwd()
    const interactive = !args.yes && !!process.stdin.isTTY
    const project = openProject(cwd, await loadTypeScript(), { cliVersion: cliVersion() })
    const { tree } = project.ctx

    if (await isGitTreeDirty(cwd)) {
      logger.warn('The git working tree has uncommitted changes.')
      if (interactive) {
        const proceed = await p.confirm({ message: 'Continue anyway?', initialValue: false })
        if (p.isCancel(proceed) || !proceed) throw new CliError('Cancelled', 0)
      }
    }

    let ids = (args._ as string[]).filter(Boolean)
    if (ids.length === 0) {
      const candidates = availableAddons(project.ctx.runtime).filter((a) => !a.isInstalled(tree, project.layout))
      if (!interactive) {
        const list = candidates.map((a) => a.id).join(', ') || 'none left'
        throw new CliError(`Name the add-ons: miia add <id...>. Available: ${list}`)
      }
      if (candidates.length === 0) {
        logger.info('Every add-on available on this runtime is installed.')
        return
      }
      const answer = await p.multiselect<string>({
        message: 'Add-ons:',
        options: candidates.map((a) => ({ value: a.id, label: a.label, hint: a.hint })),
      })
      if (p.isCancel(answer)) {
        p.cancel('Cancelled')
        return
      }
      ids = answer
    }

    const before = dependencySnapshot(tree)
    const { applied, skipped, warnings, next } = addToProject(project, ids)
    for (const addon of skipped) logger.info(`${addon.id} is already installed`)
    if (applied.length === 0) return

    if (args['dry-run']) {
      logger.info('DRY RUN - nothing is written\n')
      for (const line of tree.summary()) logger.info(`  ${line}`)
      printNewDependencies(before, dependencySnapshot(tree))
      for (const warning of new Set(warnings)) logger.warn(warning)
      printNext(next)
      return
    }

    const written = await tree.commit()
    for (const line of tree.summary()) logger.success(`  ${line}`)
    // Before the install: a failed install must not hide what is left to do by hand
    for (const warning of new Set(warnings)) logger.warn(warning)
    if (!args['skip-install'] && dependencySnapshot(tree) !== before) {
      logger.info(`\nInstalling dependencies with ${project.packageManager}...`)
      await install(project.packageManager, cwd)
    }
    await formatFiles(written, cwd)
    logger.success(`\nAdded ${applied.map((a) => a.id).join(', ')}`)
    printNext(next)
  }),
})

function printNext(steps: string[]): void {
  if (steps.length > 0) logger.info(`\nNext:\n\n  ${steps.join('\n  ')}`)
}

async function isGitTreeDirty(cwd: string): Promise<boolean> {
  const result = await execa('git', ['status', '--porcelain'], { cwd, reject: false })
  return result.exitCode === 0 && String(result.stdout).trim().length > 0
}

function printNewDependencies(before: string, after: string): void {
  const [oldDeps, oldDev] = JSON.parse(before) as [Record<string, string>, Record<string, string>]
  const [deps, dev] = JSON.parse(after) as [PackageJson['dependencies'], PackageJson['devDependencies']]
  logger.info('\n  New dependencies:')
  for (const [name, range] of Object.entries(deps ?? {})) if (!oldDeps[name]) logger.info(`    ${name} ${range}`)
  for (const [name, range] of Object.entries(dev ?? {})) if (!oldDev[name]) logger.info(`    ${name} ${range} (dev)`)
}
