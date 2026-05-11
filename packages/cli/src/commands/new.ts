import { defineCommand } from 'citty'
import { runScaffoldPrompts } from '../scaffold/prompts.js'
import { scaffoldProject } from '../scaffold/scaffold.js'
import { logger } from '../utils/logger.js'

export default defineCommand({
  meta: {
    name: 'new',
    description: 'Create a new MiiaJS project',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Project name',
      required: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Preview generated files without writing',
      default: false,
    },
    'skip-install': {
      type: 'boolean',
      description: 'Skip dependency installation',
      default: false,
    },
  },
  async run({ args }) {
    const answers = await runScaffoldPrompts(args.name as string | undefined)

    if (!answers) {
      process.exit(0)
    }

    console.log()
    await scaffoldProject({
      name: answers.name,
      runtime: answers.runtime,
      featureIds: answers.featureIds,
      packageManager: answers.packageManager,
      targetDir: answers.name,
      dryRun: args['dry-run'] as boolean,
      skipInstall: args['skip-install'] as boolean,
    })
  },
})
