import { getMeta, MODULE } from '../decorators/index.js'
import { formatPair, formatToken } from '../di-token-format.js'
import type { AnyToken, ConfiguredModule, ModuleOptions } from '../types.js'

export const OVERRIDE_KIND = Symbol('overrideKind')

/**
 * The check a descriptor carries, so an app that never overrides anything does not bundle it. The loader passes what
 * it found: for a provider override whether a loaded module provides the token, for a module override the `global`
 * of the configuration it replaces, null when the graph does not configure the pair.
 * @internal
 */
export const OVERRIDE_CHECK = Symbol('overrideCheck')

/**
 * Replaces one provider or one configured module of the loaded graph when passed to
 * `register()` next to the modules. A testing utility (`TestApp.override()` builds these);
 * consumed by the module loader, never becomes a module. Only allowed at the top level
 * of `register()`, not inside `imports`.
 */
export type OverrideDescriptor =
  | { readonly [OVERRIDE_KIND]: 'provider'; token: AnyToken; factory: () => unknown }
  | { readonly [OVERRIDE_KIND]: 'module'; module: ConfiguredModule }

/** @internal */
export type CheckedOverride = OverrideDescriptor & { readonly [OVERRIDE_CHECK]?: (found: boolean | null) => void }

/** The provider registered under `token` is built by `factory`. */
export function overrideProvider(token: AnyToken, factory: () => unknown): OverrideDescriptor {
  const descriptor: CheckedOverride = { [OVERRIDE_KIND]: 'provider', token, factory, [OVERRIDE_CHECK]: checkProvider }
  return descriptor
}

/** `configured` replaces the configured module with the same pair (`module`, `name`) wherever the graph has it. */
export function overrideModule(configured: ConfiguredModule): OverrideDescriptor {
  const descriptor: CheckedOverride = { [OVERRIDE_KIND]: 'module', module: configured, [OVERRIDE_CHECK]: checkModule }
  return descriptor
}

export function isOverride(value: unknown): value is OverrideDescriptor {
  return typeof value === 'object' && value !== null && OVERRIDE_KIND in value
}

function checkProvider(this: { token: AnyToken }, used: boolean | null): void {
  if (used) return
  const name = formatToken(this.token)
  throw new Error(`[Miia] override(${name}): no loaded module provides ${name} - use provide() for a module-less test`)
}

function checkModule(this: { module: ConfiguredModule }, configuredGlobal: boolean | null): void {
  const replacement = this.module
  const pair = formatPair(replacement.module, replacement.name ?? '')
  if (configuredGlobal === null) {
    const cls = formatToken(replacement.module)
    throw new Error(
      `[Miia] override(${pair}): ${pair} is not configured in the loaded graph - ` +
        `if a module imports ${cls} bare and expects the root to configure it, register it alongside: ` +
        `TestApp.create(FeatureModule, ${cls}.configure(...))`,
    )
  }
  const global = configuredGlobal || getMeta<ModuleOptions>(replacement.module, MODULE)?.global === true
  if (replacement.global !== undefined && replacement.global !== global) {
    throw new Error(
      `[Miia] override(${pair}): the replacement sets global: ${replacement.global}, ` +
        `but the configured module it replaces ${global ? 'is global' : 'does not'} - ` +
        'leave global out, it is inherited',
    )
  }
}
