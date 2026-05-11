import type { SchematicDefinition, SchematicName } from './types.js'
import { moduleTemplate } from './templates/module.js'
import { controllerTemplate } from './templates/controller.js'
import { serviceTemplate } from './templates/service.js'
import { middlewareTemplate } from './templates/middleware.js'
import { guardTemplate } from './templates/guard.js'

const schematics: SchematicDefinition[] = [
  {
    name: 'module',
    aliases: ['m'],
    fileSuffix: '.module',
    template: moduleTemplate,
    registrationTarget: 'imports',
  },
  {
    name: 'controller',
    aliases: ['c'],
    fileSuffix: '.controller',
    template: controllerTemplate,
    registrationTarget: 'controllers',
  },
  {
    name: 'service',
    aliases: ['s'],
    fileSuffix: '.service',
    template: serviceTemplate,
    registrationTarget: 'providers',
  },
  {
    name: 'middleware',
    aliases: [],
    fileSuffix: '.middleware',
    template: middlewareTemplate,
    registrationTarget: null,
  },
  {
    name: 'guard',
    aliases: [],
    fileSuffix: '.guard',
    template: guardTemplate,
    registrationTarget: 'providers',
  },
]

const byNameOrAlias = new Map<string, SchematicDefinition>()
for (const s of schematics) {
  byNameOrAlias.set(s.name, s)
  for (const alias of s.aliases) {
    byNameOrAlias.set(alias, s)
  }
}

/** Also recognizes "resource" / "r" - handled as composite in the runner */
const RESOURCE_ALIASES = new Set<string>(['resource', 'r'])

export function resolveSchematic(nameOrAlias: string): SchematicDefinition | 'resource' | undefined {
  if (RESOURCE_ALIASES.has(nameOrAlias)) return 'resource'
  return byNameOrAlias.get(nameOrAlias)
}

export function isResourceSchematic(result: SchematicDefinition | 'resource' | undefined): result is 'resource' {
  return result === 'resource'
}

export function listSchematics(): Array<{ name: SchematicName | 'resource'; aliases: string[] }> {
  const list: Array<{ name: SchematicName | 'resource'; aliases: string[] }> = schematics.map((s) => ({
    name: s.name,
    aliases: s.aliases,
  }))
  list.push({ name: 'resource', aliases: ['r'] })
  return list
}
