import type { Addon, AddonContext } from '../scaffold/addons.js'
import { databaseGuide } from './database-guide.js'
import {
  addEnv,
  addReadmeSection,
  configReader,
  databaseName,
  hasDependency,
  registerModule,
  warnInMemoryUsers,
} from './helpers.js'

function mongoUrl(projectName: string): string {
  return `mongodb://localhost:27017/${databaseName(projectName)}`
}

function addConnection(ctx: AddonContext, kind: 'papr' | 'mongoose'): void {
  const url = mongoUrl(ctx.projectName)
  addEnv(ctx, { key: 'MONGODB_URL', schema: 'z.string()', example: url })
  const guide = databaseGuide(ctx, kind, url)
  addReadmeSection(ctx, '## Database', guide.section)
  for (const step of guide.steps) ctx.next(step)
  warnInMemoryUsers(ctx)
}

export const papr: Addon = {
  id: 'papr',
  label: 'Papr + MongoDB',
  hint: 'typed MongoDB models via Papr',
  kind: 'database',
  isInstalled: (tree) => hasDependency(tree, '@miiajs/papr'),
  apply(ctx) {
    ctx.template()
    const config = configReader(ctx)
    registerModule(ctx, {
      ref: 'PaprModule',
      element: [
        'PaprModule.configure(',
        '  (resolve) => ({',
        `    connection: { url: ${config.get('MONGODB_URL')} },`,
        '  }),',
        '  { global: true },',
        ')',
      ].join('\n'),
      imports: [{ from: '@miiajs/papr', names: ['PaprModule'] }, ...config.imports],
    })
    addConnection(ctx, 'papr')
  },
}

export const mongoose: Addon = {
  id: 'mongoose',
  label: 'Mongoose + MongoDB',
  hint: 'MongoDB models via Mongoose',
  kind: 'database',
  isInstalled: (tree) => hasDependency(tree, '@miiajs/mongoose'),
  apply(ctx) {
    ctx.template()
    const config = configReader(ctx)
    registerModule(ctx, {
      ref: 'MongooseModule',
      element: [
        'MongooseModule.configure(',
        '  (resolve) => ({',
        `    uri: ${config.get('MONGODB_URL')},`,
        '  }),',
        '  { global: true },',
        ')',
      ].join('\n'),
      imports: [{ from: '@miiajs/mongoose', names: ['MongooseModule'] }, ...config.imports],
    })
    addConnection(ctx, 'mongoose')
  },
}
