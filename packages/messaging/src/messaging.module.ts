import type { ConfiguredModule, Constructor, OptionsOrFactory } from '@miiajs/core'
import { resolveOptions } from '@miiajs/core'
import { MessageBus } from './message-bus.js'
import { type IdempotencyStore } from './idempotency.js'
import { getMessageBusToken, getMessageTransportToken, getIdempotencyStoreToken } from './tokens.js'
import { type DispatchMode, type MessageTransport } from './types.js'

/**
 * Bus-level defaults for dispatch behavior. Per-handler `@On({ mode, concurrency })`
 * overrides these; if neither this nor the handler declares a value, the
 * transport's `defaultMode` and a concurrency of `1` apply.
 */
export interface DispatchDefaults {
  mode?: DispatchMode
  concurrency?: number
}

export interface MessagingModuleOptions {
  transport: MessageTransport
  /**
   * Optional idempotency store for `@Idempotent` handlers. MessageBus throws
   * at startup if any handler is annotated with `@Idempotent` but no store
   * is configured here.
   */
  idempotency?: IdempotencyStore
  /**
   * Bus-wide dispatch defaults. Resolution chain at `MessageBus.onReady()`:
   *
   *   `@On({ mode, concurrency })` > this `dispatch` > `transport.defaultMode` (and 1).
   */
  dispatch?: DispatchDefaults
  /**
   * Application namespace for auto-derived consumer group names. When set,
   * groups become `${appName}:${topic}__${ClassName}_${methodName}`. Use to
   * avoid collisions when multiple services share a broker and have handlers
   * with overlapping class names - without `appName`, their auto-derived
   * groups collide and the broker round-robins messages between unrelated
   * services.
   *
   * Does NOT prefix:
   * - topics (those are shared cross-service contract)
   * - explicit `@On({ group: '...' })` (user-controlled, full-qualified)
   *
   * Recommended for any production deployment with shared infrastructure.
   */
  appName?: string
}

/**
 * Dynamic module that registers a message transport, optional idempotency
 * store, and `MessageBus` in the container.
 *
 * Pass an optional `name` to register a **named bus** alongside the default
 * one - useful when an app needs more than one transport (Kafka + Redis,
 * internal in-memory bus + external Redis, etc.). Handlers target a specific
 * bus via `@On(topic, { bus: name })`.
 *
 * @example
 * ```ts
 * // Static form, default bus
 * MessagingModule.configure({ transport: inMemoryTransport() })
 *
 * // Factory form with DI access
 * MessagingModule.configure((resolve) => ({
 *   transport: redisStreamsTransport({
 *     url: resolve(ConfigService).getOrThrow('REDIS_URL'),
 *   }),
 * }))
 *
 * // Multi-bus: default + named
 * MessagingModule.configure({ transport: redisStreamsTransport({ url: '...' }) })
 * MessagingModule.configure({ transport: kafkaTransport({ ... }) }, 'kafka')
 *
 * // In a handler
 * @On('order.placed')                      // default bus
 * @On('legacy.user', { bus: 'kafka' })     // named bus
 * ```
 */
export class MessagingModule {
  static configure(optionsOrFactory: OptionsOrFactory<MessagingModuleOptions>, name?: string): ConfiguredModule {
    const transportToken = getMessageTransportToken(name)
    const storeToken = getIdempotencyStoreToken(name)
    const busToken = getMessageBusToken(name)

    // Anonymous module class per name so the DI module loader does not flag
    // a duplicate when configure() is called twice with different names.
    const ModuleClass = name ? (class MessagingNamedModule {} as Constructor) : MessagingModule

    return {
      module: ModuleClass,
      providers: [
        {
          token: transportToken,
          factory: (resolve) => resolveOptions(optionsOrFactory, { resolve }).transport,
        },
        {
          // Always registered so MessageBus's optional read resolves cleanly.
          // Value is `null` when the user did not configure a store.
          token: storeToken,
          factory: (resolve) => resolveOptions(optionsOrFactory, { resolve }).idempotency ?? null,
        },
        {
          token: busToken,
          factory: (resolve) => {
            const transport = resolve<MessageTransport>(transportToken)
            const store = resolve<IdempotencyStore | null>(storeToken)
            const opts = resolveOptions(optionsOrFactory, { resolve })
            return new MessageBus(transport, store, name ?? null, {
              dispatch: opts.dispatch ?? null,
              appName: opts.appName ?? null,
            })
          },
        },
      ],
    }
  }
}
