import { formatToken } from '../di-token-format.js'
import type { AnyToken } from '../types.js'
import type { ModuleGraph, ModuleNode } from './module-graph.js'

/** Marks the start-up report, and an error that escaped the start-up window with violations appended. */
export const BOUNDARY_REPORT = Symbol('miia.boundaryReport')

export interface BoundaryViolation {
  /** A provider, a guard, the controller that uses a guard; `Resolver` for a Resolver bound to `from`. */
  requester: AnyToken
  /** The module the requester is checked from; null for the root. */
  from: ModuleNode | null
  /** A requester without a module, registered with `app.provide()`. */
  provided: boolean
  token: AnyToken
  /** The module that declares `token`. */
  owner: ModuleNode
  /** `uses`: a controller uses a guard; `useGuard`: a global guard; `resolve`: Resolver.resolve(). */
  via: 'inject' | 'deps' | 'uses' | 'useGuard' | 'resolve'
  /** For a guard no module declares: the controller whose module it is checked from. */
  controller: AnyToken | null
}

interface Block {
  requester: AnyToken
  from: ModuleNode | null
  provided: boolean
  owner: ModuleNode
  via: BoundaryViolation['via']
  controller: AnyToken | null
  tokens: AnyToken[]
}

const DOCS = 'Docs: /docs/core-concepts/modules#boundaries'

/** `Name (OwnerModule)` for a token a module declares, else `Name`. */
export function describe(token: AnyToken, owner: ModuleNode | null): string {
  return owner ? `${formatToken(token)} (${owner.where})` : formatToken(token)
}

export function isBoundaryReport(error: unknown): boolean {
  return typeof error === 'object' && error !== null && BOUNDARY_REPORT in error
}

export function boundaryReport(violations: BoundaryViolation[], graph: ModuleGraph): Error {
  const blocks = describeBlocks(violations, graph)
  return new Error([`[Miia] ${count(blocks.length)}:`, ...blocks, DOCS].join('\n\n'))
}

/** The report of the start-up window. */
export function startupReport(violations: BoundaryViolation[], graph: ModuleGraph): Error {
  return marked(boundaryReport(violations, graph))
}

/** `error` with the violations of the start-up window appended; the original is the cause. */
export function withViolations(error: unknown, violations: BoundaryViolation[], graph: ModuleGraph): Error {
  const message = error instanceof Error ? error.message : String(error)
  const blocks = describeBlocks(violations, graph)
  const text = [message, `Also found ${count(blocks.length)} so far:`, ...blocks, DOCS].join('\n\n')
  return marked(new Error(text, { cause: error }))
}

function marked(error: Error): Error {
  Object.defineProperty(error, BOUNDARY_REPORT, { value: true })
  return error
}

function count(n: number): string {
  return `${n} module boundary violation${n === 1 ? '' : 's'}`
}

/** One block per requester (and the module it is checked from) and module of the tokens; identical blocks once. */
function describeBlocks(violations: BoundaryViolation[], graph: ModuleGraph): string[] {
  const blocks: Block[] = []
  for (const v of violations) {
    let block = blocks.find(
      (b) =>
        b.requester === v.requester &&
        b.from === v.from &&
        b.controller === v.controller &&
        b.owner === v.owner &&
        b.via === v.via,
    )
    if (!block) {
      const { requester, from, provided, owner, via, controller } = v
      block = { requester, from, provided, owner, via, controller, tokens: [] }
      blocks.push(block)
    }
    if (!block.tokens.includes(v.token)) block.tokens.push(v.token)
  }
  return [...new Set(blocks.map((block) => describeBlock(block, graph)))]
}

function describeBlock(block: Block, graph: ModuleGraph): string {
  const { from, owner } = block
  // A configured module's factory also sees what its host sees: the advice goes to the host.
  const target = from === null ? graph.root : (from.host ?? from)
  const lines: string[] = []

  let path: string[] = []
  const hidden = block.tokens.filter((token) => !owner.exportedTokens.has(token))
  if (owner.configured && !owner.hasExports) {
    // Nothing the importer does helps until the module exports something.
    lines.push(`${configureCall(owner)} exports nothing - its author should list its public providers in exports`)
  } else {
    if (hidden.length > 0) {
      const names = hidden.map(formatToken).join(', ')
      lines.push(
        owner.configured
          ? `${configureCall(owner)} does not export ${names}`
          : `add ${names} to ${owner.label} \`exports\``,
      )
    }
    if (!reaches(target, owner) && !(from !== null && reaches(from, owner))) path = pathAdvice(owner, target)
    lines.push(...path)
  }
  // The heads of a global guard and of Resolver end in a clause of their own.
  const notGlobal =
    hidden.length === 0 &&
    path.length > 0 &&
    owner.configured &&
    hasConfigure(owner) &&
    block.via !== 'useGuard' &&
    block.via !== 'resolve'

  const tokens = `${block.tokens.map(formatToken).join(', ')} (${owner.where})`
  return [
    `${heading(block, tokens)}${notGlobal ? ', which is not global' : ''}:`,
    ...lines.map((line) => `  - ${line}`),
  ].join('\n')
}

function heading(block: Block, tokens: string): string {
  switch (block.via) {
    case 'resolve': {
      const view = block.from ? block.from.where : 'the root'
      return `Resolver of ${view} resolved ${tokens}, which ${view} cannot see`
    }
    case 'useGuard':
      return `${tokens}, registered with app.useGuard(), is not visible from the root`
    case 'uses':
      return `${requesterOf(block)} uses ${tokens}`
    case 'deps':
      return `${requesterOf(block)} lists ${tokens} in deps`
    default:
      return `${requesterOf(block)} injects ${tokens}`
  }
}

function requesterOf(block: Block): string {
  const { from, controller } = block
  const name = formatToken(block.requester)
  if (from === null) {
    return `${name} (${block.provided ? 'registered with app.provide()' : 'global guard'}, checked from the root)`
  }
  if (controller !== null) return `${name} (guard of ${formatToken(controller)} in ${from.where})`
  return describe(block.requester, from)
}

/** How `target` gets to the exports of `owner`. */
function pathAdvice(owner: ModuleNode, target: ModuleNode): string[] {
  if (!owner.configured) {
    return target.isRoot
      ? [`pass ${owner.label} to app.register(), or make ${owner.label} global`]
      : [`add ${owner.label} to ${target.label} \`imports\``]
  }
  const cls = formatToken(owner.module!)
  if (!hasConfigure(owner)) {
    // A configure() result without configure(), e.g. the module of register(): re-exported by its host.
    const host = owner.host!
    if (host.isRoot) return [`import ${owner.label} in ${target.label} instead of passing it to app.register()`]
    const lines: string[] = []
    if (!host.reexports.includes(owner)) lines.push(`add ${owner.label} to ${host.label} \`exports\``)
    if (!target.imports.includes(host)) {
      lines.push(
        target.isRoot ? `pass ${host.label} to app.register()` : `add ${host.label} to ${target.label} \`imports\``,
      )
    }
    return lines
  }
  if (owner.name) {
    return [
      `make it global: ${cls}.configure(options, { name: '${owner.name}', global: true })`,
      target.isRoot
        ? 'or pass that configure() result to app.register() instead'
        : `or import that configure() result in ${target.label} only and re-export it`,
    ]
  }
  return [
    `make it global: ${cls}.configure(options, { global: true })`,
    target.isRoot ? `or pass ${cls} to app.register()` : `or add ${cls} to ${target.label} \`imports\``,
  ]
}

/** `node` imports `owner`, directly or through re-exports, or `owner` is global. */
function reaches(node: ModuleNode, owner: ModuleNode): boolean {
  if (owner.global) return true
  const visited = new Set<ModuleNode>()
  const walk = (current: ModuleNode): boolean => {
    if (current === owner) return true
    if (visited.has(current)) return false
    visited.add(current)
    return current.reexports.some(walk)
  }
  return node.imports.some(walk)
}

function hasConfigure(node: ModuleNode): boolean {
  return typeof (node.module as { configure?: unknown } | null)?.configure === 'function'
}

function configureCall(node: ModuleNode): string {
  const cls = formatToken(node.module!)
  return hasConfigure(node) ? `${cls}.configure()` : cls
}
