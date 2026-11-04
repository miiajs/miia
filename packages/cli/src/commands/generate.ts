import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { runGenerate } from '../generate/runner.js'
import { describeSchematics, listSchematics } from '../generate/schematics.js'
import { action, CliError } from '../utils/errors.js'
import { validateArtifactName } from '../utils/naming.js'

export default defineCommand({
  meta: {
    name: 'generate',
    description: 'Generate a MiiaJS artifact (alias: g)',
  },
  args: {
    schematic: {
      type: 'positional',
      description: 'Schematic: module (m), controller (c), service (s), resource (r), guard, middleware, table',
      required: false,
    },
    name: {
      type: 'positional',
      description: 'Name of the artifact (e.g. "users" or "admin/users")',
      required: false,
    },
    path: {
      type: 'string',
      description: 'Folder under src/',
    },
    flat: {
      type: 'boolean',
      description: 'Do not create a folder for the artifact (guard and middleware never get one)',
      default: false,
    },
    export: {
      type: 'boolean',
      description: 'Also add the service to exports of the parent module',
      default: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print the changes without writing them',
      default: false,
    },
  },
  run: action(async ({ args }) => {
    let schematic = args.schematic as string | undefined
    let name = args.name as string | undefined

    if (!schematic || !name) {
      if (!process.stdin.isTTY) {
        throw new CliError(`Usage: miia g <schematic> <name>\nSchematics: ${describeSchematics()}`)
      }
      if (!schematic) {
        const answer = await p.select<string>({
          message: 'Schematic:',
          options: listSchematics().map((s) => ({ value: s.name, label: s.name, hint: s.aliases.join(', ') })),
        })
        if (p.isCancel(answer)) {
          p.cancel('Cancelled')
          return
        }
        schematic = answer
      }
      if (!name) {
        const answer = await p.text({
          message: 'Name:',
          placeholder: 'users',
          validate: (value) => {
            try {
              validateArtifactName(value ?? '')
              return undefined
            } catch (err) {
              return (err as Error).message
            }
          },
        })
        if (p.isCancel(answer)) {
          p.cancel('Cancelled')
          return
        }
        name = answer.trim()
      }
    }

    await runGenerate({
      schematic,
      name,
      path: args.path as string | undefined,
      flat: args.flat as boolean,
      export: args.export as boolean,
      dryRun: args['dry-run'] as boolean,
    })
  }),
})
