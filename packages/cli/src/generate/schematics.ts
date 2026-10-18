import type { ModuleKey } from '../codemod/source.js'

export type SchematicName = 'module' | 'controller' | 'service' | 'guard' | 'middleware' | 'resource'

export interface Schematic {
  name: SchematicName
  aliases: string[]
  /** resource: always in its own <file>/ folder; the rest only without --flat and without a slash in the name */
  alwaysNested: boolean
  /** What goes into the parent module */
  register?: { key: Exclude<ModuleKey, 'exports'>; className: (name: string) => string; file: (file: string) => string }
  /** --export also lists the class in `exports` */
  exportable?: boolean
}

// A guard is not registered: an undeclared guard is constructed for the controller that uses it,
// with that controller's module boundaries, so it works from any module
const schematics: Schematic[] = [
  {
    name: 'module',
    aliases: ['m'],
    alwaysNested: false,
    register: { key: 'imports', className: (n) => `${n}Module`, file: (f) => `${f}.module.ts` },
  },
  {
    name: 'controller',
    aliases: ['c'],
    alwaysNested: false,
    register: { key: 'controllers', className: (n) => `${n}Controller`, file: (f) => `${f}.controller.ts` },
  },
  {
    name: 'service',
    aliases: ['s'],
    alwaysNested: false,
    register: { key: 'providers', className: (n) => `${n}Service`, file: (f) => `${f}.service.ts` },
    exportable: true,
  },
  { name: 'guard', aliases: [], alwaysNested: false },
  { name: 'middleware', aliases: [], alwaysNested: false },
  {
    name: 'resource',
    aliases: ['r'],
    alwaysNested: true,
    register: { key: 'imports', className: (n) => `${n}Module`, file: (f) => `${f}.module.ts` },
  },
]

export function resolveSchematic(nameOrAlias: string): Schematic | undefined {
  return schematics.find((s) => s.name === nameOrAlias || s.aliases.includes(nameOrAlias))
}

export function listSchematics(): readonly Schematic[] {
  return schematics
}

export function describeSchematics(): string {
  return schematics.map((s) => (s.aliases.length ? `${s.name} (${s.aliases.join(', ')})` : s.name)).join(', ')
}
