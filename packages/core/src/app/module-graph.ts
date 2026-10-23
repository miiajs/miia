import type { AnyToken, ConfiguredModule, Constructor } from '../types.js'

/** One module of the graph: a pair (class, name), or the virtual root that `register()` imports into. */
export class ModuleNode {
  readonly owns = new Set<AnyToken>()
  readonly imports: ModuleNode[] = []
  readonly exportedTokens = new Set<AnyToken>()
  readonly reexports: ModuleNode[] = []
  global = false
  /** Some source declares `exports`, even an empty list. */
  hasExports = false
  /** The module whose `imports` hold this configure() result, the root for `register()`; null when not configured. */
  host: ModuleNode | null = null
  /** The configure() result of the pair, an override in its place; set while the graph loads, null afterwards. */
  config: ConfiguredModule | null = null
  processed = false

  constructor(
    readonly label: string,
    readonly isRoot = false,
    /** The class of the pair, for advice in messages; null for the root. */
    readonly module: Constructor | null = null,
    /** The configuration name of the pair, '' for none. */
    readonly name = '',
  ) {}

  get configured(): boolean {
    return this.host !== null
  }

  /** The label, plus ` in <host>` for a configured module (` in register()` when the root hosts it). */
  get where(): string {
    return this.host ? `${this.label} in ${this.host.importer}` : this.label
  }

  /** How messages name this module as the one that imports something: the root is `register()`. */
  get importer(): string {
    return this.isRoot ? 'register()' : this.label
  }
}

/** Built by the module loader while it processes the graph, read-only afterwards. */
export class ModuleGraph {
  /** Owns nothing, exports nothing; imports every module passed to `register()`. */
  readonly root = new ModuleNode('<root>', true)
  private nodes: ModuleNode[] = []
  /** Only for modules with re-exports: the others expose their exportedTokens as they are. */
  private publicCache = new Map<ModuleNode, ReadonlySet<AnyToken>>()
  private globalCache: ReadonlySet<AnyToken> | null = null

  createNode(label: string, module: Constructor, name: string): ModuleNode {
    const node = new ModuleNode(label, false, module, name)
    this.nodes.push(node)
    return node
  }

  /** Tokens `node` makes visible to an importer: its exports and, recursively, those of re-exported modules. */
  publicTokens(node: ModuleNode): ReadonlySet<AnyToken> {
    if (node.reexports.length === 0) return node.exportedTokens
    const cached = this.publicCache.get(node)
    if (cached) return cached
    const tokens = new Set<AnyToken>()
    const visited = new Set<ModuleNode>()
    const walk = (current: ModuleNode): void => {
      if (visited.has(current)) return
      visited.add(current)
      for (const token of current.exportedTokens) tokens.add(token)
      for (const next of current.reexports) walk(next)
    }
    walk(node)
    this.publicCache.set(node, tokens)
    return tokens
  }

  /** Owned, exported by an import (with re-exports), or exported by a global module (with re-exports). */
  sees(from: ModuleNode, token: AnyToken): boolean {
    if (from.owns.has(token) || this.globalTokens().has(token)) return true
    for (const imported of from.imports) {
      if (this.publicTokens(imported).has(token)) return true
    }
    return false
  }

  private globalTokens(): ReadonlySet<AnyToken> {
    if (this.globalCache) return this.globalCache
    const tokens = new Set<AnyToken>()
    for (const node of this.nodes) {
      if (!node.global) continue
      for (const t of this.publicTokens(node)) tokens.add(t)
    }
    this.globalCache = tokens
    return tokens
  }
}
