import type {
  DispatchMode,
  HandlerResult,
  InitialPositionKind,
  MessageEnvelope,
  MessageTransport,
  SubscribeOptions,
  Subscription,
} from '../../src/types.js'

export interface StubSubscribeRecord {
  topic: string
  options: SubscribeOptions
}

export interface StubTransportOptions {
  supportedModes: readonly DispatchMode[]
  defaultMode: DispatchMode
  /** Default `true` - assume broker-style competing consumers unless otherwise specified. */
  supportsCompetingConsumers?: boolean
  /** Set on the instance only when given, so a transport that does not declare it can be tested. */
  supportedInitialPositions?: readonly InitialPositionKind[]
}

/**
 * Test double that records every `subscribe()` call so resolution-chain tests
 * can assert which `(mode, concurrency, group)` reached the transport. Has no
 * delivery semantics - publishes are accepted and discarded.
 */
export class StubTransport implements MessageTransport {
  readonly supportedModes: readonly DispatchMode[]
  readonly defaultMode: DispatchMode
  readonly supportsCompetingConsumers: boolean
  readonly supportedInitialPositions?: readonly InitialPositionKind[]
  readonly subscribes: StubSubscribeRecord[] = []

  constructor(options: StubTransportOptions) {
    this.supportedModes = options.supportedModes
    this.defaultMode = options.defaultMode
    this.supportsCompetingConsumers = options.supportsCompetingConsumers ?? true
    if (options.supportedInitialPositions) this.supportedInitialPositions = options.supportedInitialPositions
  }

  async publish(_envelope: MessageEnvelope): Promise<void> {
    // intentionally a no-op
  }

  async subscribe(
    topic: string,
    _handler: (envelope: MessageEnvelope) => Promise<HandlerResult>,
    options: SubscribeOptions,
  ): Promise<Subscription> {
    this.subscribes.push({ topic, options })
    return {
      unsubscribe: async () => {},
    }
  }
}

export function stubTransport(options: StubTransportOptions): StubTransport {
  return new StubTransport(options)
}
