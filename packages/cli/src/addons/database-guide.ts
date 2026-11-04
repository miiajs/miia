import type { AddonContext } from '../scaffold/addons.js'
import { databaseName } from './helpers.js'

export type DatabaseKind = 'postgres' | 'mysql' | 'sqlite' | 'papr' | 'mongoose'

export interface DatabaseGuide {
  /** The text under `## Database` in README.md */
  section: string
  /** Short steps `miia new` / `miia add` print */
  steps: string[]
}

const FENCE = '```'

const SERVERS = {
  postgres: {
    label: 'PostgreSQL',
    docker: (db: string) =>
      `docker run -d --name ${db}-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=${db} -p 5432:5432 postgres:17`,
    create: (db: string) => `createdb ${db}`,
  },
  mysql: {
    label: 'MySQL',
    docker: (db: string) =>
      `docker run -d --name ${db}-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=${db} -p 3306:3306 mysql:8.4`,
    create: (db: string) => `CREATE DATABASE ${db}`,
  },
}

/** How to start and migrate the database; `url` is the default connection URL the add-on writes to .env. */
export function databaseGuide(ctx: AddonContext, kind: DatabaseKind, url: string): DatabaseGuide {
  const db = databaseName(ctx.projectName)
  const see = ctx.tree.exists('README.md') ? ' (see README)' : ''

  if (kind === 'papr' || kind === 'mongoose') {
    const section = [
      `The app connects to \`MONGODB_URL\` in \`.env\`, by default \`${url}\`.`,
      '',
      'Start MongoDB, for example in Docker:',
      '',
      `${FENCE}bash`,
      `docker run -d --name ${db}-mongo -p 27017:27017 mongo:8`,
      FENCE,
      '',
      `Or use a MongoDB you already run. MongoDB creates the \`${db}\` database on the first write, so there is nothing to migrate. Models: https://miiajs.com/docs/packages/${kind}`,
    ]
    return { section: section.join('\n'), steps: [`start MongoDB${see}`] }
  }

  // jwt-auth in this run brings the users table: the app needs it migrated, and there is a table to start from
  const withUsers = ctx.adding('jwt-auth')
  const addTable = withUsers ? [] : [ctx.miia('g table posts')]
  if (kind === 'sqlite') {
    const section = [
      `The app opens the SQLite file named by \`DATABASE_URL\` in \`.env\`, by default \`${url}\` in the project folder, so there is no server to start${withUsers ? '. Create the tables and start the app' : ''}:`,
      ...startApp(ctx, withUsers),
      ...tableGuide(ctx, ctx.flavor === 'bun' ? ' (through `src/db.migrate.ts` on Bun)' : ''),
    ]
    return { section: section.join('\n'), steps: addTable }
  }

  const server = SERVERS[kind]
  const section = [
    `The app connects to \`DATABASE_URL\` in \`.env\`, by default \`${url}\`.`,
    '',
    `Start ${server.label} with a \`${db}\` database, for example in Docker:`,
    '',
    `${FENCE}bash`,
    server.docker(db),
    FENCE,
    '',
    `Or create it in a ${server.label} you already run (\`${server.create(db)}\`), or set \`DATABASE_URL\` to another database. Then ${withUsers ? 'create the tables and start the app' : 'start the app'}:`,
    ...startApp(ctx, withUsers),
    ...tableGuide(ctx, ''),
  ]
  return { section: section.join('\n'), steps: [`start ${server.label} with a "${db}" database${see}`, ...addTable] }
}

function startApp(ctx: AddonContext, withUsers: boolean): string[] {
  const migrate = withUsers ? [ctx.run('db:generate'), ctx.run('db:migrate')] : []
  return ['', `${FENCE}bash`, ...migrate, ctx.run('dev'), FENCE]
}

function tableGuide(ctx: AddonContext, migrateNote: string): string[] {
  return [
    '',
    'Add a table, then create it in the database:',
    '',
    `${FENCE}bash`,
    ctx.miia('g table posts'),
    ctx.run('db:generate'),
    ctx.run('db:migrate'),
    FENCE,
    '',
    `\`miia g table\` writes \`src/posts/posts.table.ts\` and adds it to \`src/db.schema.ts\`, \`db:generate\` writes SQL migrations for that schema to \`drizzle/\`, \`db:migrate\` applies them${migrateNote}. Run both again after changing a table.`,
    '',
    'In a service next to the table, inject the typed handle from `src/db.ts`:',
    '',
    `${FENCE}ts`,
    "import { Injectable, inject } from '@miiajs/core'",
    "import { db } from '../db.js'",
    "import { posts } from './posts.table.js'",
    '',
    '@Injectable()',
    'export class PostsService {',
    '  private readonly db = inject(db)',
    '',
    '  findAll() {',
    '    return this.db.select().from(posts)',
    '  }',
    '}',
    FENCE,
  ]
}
