import type { ConfiguredModule, Constructor } from '../types.js'

export const OVERRIDE_KIND = Symbol('overrideKind')

/**
 * Replaces one provider or one configured module of the loaded graph when passed to
 * `register()` next to the modules. A testing utility (`TestApp.override()` builds these);
 * consumed by the module loader, never becomes a module. Only allowed at the top level
 * of `register()`, not inside `imports`.
 */
export type OverrideDescriptor =
  | { readonly [OVERRIDE_KIND]: 'provider'; token: Constructor | string; factory: () => unknown }
  | { readonly [OVERRIDE_KIND]: 'module'; module: ConfiguredModule }

/** The provider registered under `token` (and its `@Injectable({ token })` alias) is built by `factory`. */
export function overrideProvider(token: Constructor | string, factory: () => unknown): OverrideDescriptor {
  return { [OVERRIDE_KIND]: 'provider', token, factory }
}

/** `configured` replaces the configured module with the same pair (`module`, `name`) wherever the graph has it. */
export function overrideModule(configured: ConfiguredModule): OverrideDescriptor {
  return { [OVERRIDE_KIND]: 'module', module: configured }
}

export function isOverride(value: unknown): value is OverrideDescriptor {
  return typeof value === 'object' && value !== null && OVERRIDE_KIND in value
}
