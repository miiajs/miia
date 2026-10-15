import { Miia, overrideModule, overrideProvider } from '@miiajs/core'
import type {
  AbstractConstructor,
  AnyToken,
  ConfiguredModule,
  Constructor,
  Guard,
  Middleware,
  OverrideDescriptor,
  ProviderDefinition,
  Token,
} from '@miiajs/core'

function isConfiguredModule(value: unknown): value is ConfiguredModule {
  const candidate = value as Partial<ConfiguredModule> | null
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.module === 'function' &&
    Array.isArray(candidate.providers)
  )
}

function nameOf(token: AnyToken): string {
  return token.name || '<anonymous>'
}

export class TestApp {
  private app?: Miia
  private overrides: OverrideDescriptor[] = []
  private providers: ProviderDefinition[] = []
  private middlewares: Middleware[] = []
  private guards: Guard[] = []
  private globalPrefix?: string
  private modules: (Constructor | ConfiguredModule)[]

  private constructor(modules: (Constructor | ConfiguredModule)[]) {
    this.modules = modules
  }

  static create(...modules: (Constructor | ConfiguredModule)[]): TestApp {
    return new TestApp(modules)
  }

  provide(...providers: ProviderDefinition[]): this {
    this.assertNotCompiled('provide')
    this.providers.push(...providers)
    return this
  }

  override(module: Constructor, configured: ConfiguredModule): this
  override<T>(token: Token<T> | AbstractConstructor<T>, value: Partial<T> | (() => Partial<T>)): this
  override(token: AnyToken, value: unknown): this {
    this.assertNotCompiled('override')
    if (isConfiguredModule(value)) {
      if (value.module !== token) {
        throw new Error(
          `[Miia] TestApp.override(${nameOf(token)}, ...): the configured module's class is ${nameOf(value.module)}, ` +
            `not ${nameOf(token)}`,
        )
      }
      this.overrides.push(overrideModule(value))
      return this
    }
    const factory = typeof value === 'function' && !value.prototype ? (value as () => unknown) : () => value
    this.overrides.push(overrideProvider(token, factory))
    return this
  }

  use(...middlewares: Middleware[]): this {
    this.assertNotCompiled('use')
    this.middlewares.push(...middlewares)
    return this
  }

  useGuard(...guards: Guard[]): this {
    this.assertNotCompiled('useGuard')
    this.guards.push(...guards)
    return this
  }

  setGlobalPrefix(prefix: string): this {
    this.assertNotCompiled('setGlobalPrefix')
    this.globalPrefix = prefix
    return this
  }

  async compile(): Promise<TestApp> {
    this.assertNotCompiled('compile')
    const app = new Miia({ logger: false, globalPrefix: this.globalPrefix })
    this.app = app

    // Register explicit providers (for unit tests without modules)
    app.provide(...this.providers)
    app.use(...this.middlewares)
    app.useGuard(...this.guards)
    app.register(...this.modules, ...this.overrides)

    await app.init()
    return this
  }

  async request(
    method: string,
    path: string,
    options?: {
      body?: any
      headers?: Record<string, string>
      query?: Record<string, string>
      ip?: string
    },
  ): Promise<Response> {
    const app = this.compiled()
    let url = `http://localhost${path}`
    if (options?.query) {
      const params = new URLSearchParams(options.query)
      url += `?${params}`
    }

    const init: RequestInit = { method, headers: options?.headers }
    if (options?.body !== undefined) {
      init.body = JSON.stringify(options.body)
      init.headers = {
        'Content-Type': 'application/json',
        ...options?.headers,
      }
    }
    const req = new Request(url, init)
    if (options?.ip !== undefined) (req as any)._conn = { remoteAddress: options.ip }
    return app.fetch(req)
  }

  resolve<T>(token: Token<T> | AbstractConstructor<T>): T {
    return this.compiled().get<T>(token)
  }

  async close(): Promise<void> {
    await this.compiled().destroy()
  }

  private compiled(): Miia {
    if (!this.app) throw new Error('[Miia] TestApp: call compile() first')
    return this.app
  }

  private assertNotCompiled(method: string): void {
    if (this.app) throw new Error(`[Miia] TestApp: ${method}() after compile()`)
  }
}
