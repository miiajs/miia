import { defineCommand } from 'citty'
import * as p from '@clack/prompts'
import { runGenerate } from '../generate/runner.js'

export default defineCommand({
  meta: {
    name: 'generate',
    description: 'Generate a MiiaJS artifact (alias: g)',
  },
  args: {
    schematic: {
      type: 'positional',
      description: 'Schematic: module (m), controller (c), service (s), resource (r), middleware, guard',
      required: false,
    },
    name: {
      type: 'positional',
      description: 'Name of the artifact (e.g. "user" or "auth/user")',
      required: false,
    },
    path: {
      type: 'string',
      description: 'Subdirectory under src/',
    },
    flat: {
      type: 'boolean',
      description: 'Do not create a subdirectory for the artifact',
      default: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Preview generated files without writing',
      default: false,
    },
  },
  async run({ args }) {
    let schematic = args.schematic as string | undefined
    let name = args.name as string | undefined

    if (!schematic) {
      const answer = await p.text({
        message: 'Which schematic?',
        placeholder: 'module | controller | service | resource | middleware | guard',
        validate: (v) => (!v?.trim() ? 'Required' : undefined),
      })
      if (p.isCancel(answer)) return process.exit(0)
      schematic = answer.trim()
    }

    if (!name) {
      const answer = await p.text({
        message: 'Artifact name:',
        placeholder: 'user',
        validate: (v) => (!v?.trim() ? 'Required' : undefined),
      })
      if (p.isCancel(answer)) return process.exit(0)
      name = answer.trim()
    }

    await runGenerate({
      schematic,
      name,
      path: args.path as string | undefined,
      flat: args.flat as boolean,
      dryRun: args['dry-run'] as boolean,
    })
  },
})
