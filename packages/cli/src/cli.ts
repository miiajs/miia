import { defineCommand } from 'citty'

export const main = defineCommand({
  meta: {
    name: 'miia',
    description: 'MiiaJS CLI - build, develop, and scaffold MiiaJS applications',
  },
  subCommands: {
    dev: () => import('./commands/dev.js').then((m) => m.default),
    build: () => import('./commands/build.js').then((m) => m.default),
    start: () => import('./commands/start.js').then((m) => m.default),
    check: () => import('./commands/check.js').then((m) => m.default),
    new: () => import('./commands/new.js').then((m) => m.default),
    generate: () => import('./commands/generate.js').then((m) => m.default),
    g: () => import('./commands/generate.js').then((m) => m.default),
  },
})
