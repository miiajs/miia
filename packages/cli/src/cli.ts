import { defineCommand, runMain } from 'citty'
import { cliVersion } from './utils/package-info.js'

export const main = defineCommand({
  meta: {
    name: 'miia',
    version: cliVersion(),
    description: 'MiiaJS CLI - build, develop, and scaffold MiiaJS applications',
  },
  subCommands: {
    dev: () => import('./commands/dev.js').then((m) => m.default),
    build: () => import('./commands/build.js').then((m) => m.default),
    start: () => import('./commands/start.js').then((m) => m.default),
    check: () => import('./commands/check.js').then((m) => m.default),
    new: () => import('./commands/new.js').then((m) => m.default),
    add: () => import('./commands/add.js').then((m) => m.default),
    generate: () => import('./commands/generate.js').then((m) => m.default),
    g: () => import('./commands/generate.js').then((m) => m.default),
  },
})

/** Runs the CLI with the given arguments (without the `node bin` prefix). */
export function run(argv: string[]): Promise<void> {
  return runMain(main, { rawArgs: argv })
}
