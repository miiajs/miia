import { Miia } from '../app/app.js'
import type { Container } from '../di-container.js'
import type { ConfiguredModule, Constructor, Guard, Middleware, ProviderDefinition } from '../types.js'

export class TestApp {
  private app: Miia
  private overrides = new Map<Constructor | string, any>()
  private providers: ProviderDefinition[] = []
  private modules: (Constructor | ConfiguredModule)[]

  private constructor(modules: (Constructor | ConfiguredModule)[]) {
    this.app = new Miia({ logger: false })
    this.modules = modules
  }

  static create(...modules: (Constructor | ConfiguredModule)[]): TestApp {
    return new TestApp(modules)
  }

  provide(...providers: ProviderDefinition[]): this {
    this.providers.push(...providers)
    return this
  }

  override(token: Constructor | string, value: unknown): this {
    this.overrides.set(token, value)
    return this
  }

  use(...middlewares: Middleware[]): this {
    this.app.use(...middlewares)
    return this
  }

  useGuard(...guards: Guard[]): this {
    this.app.useGuard(...guards)
    return this
  }

  async compile(): Promise<TestApp> {
    const container = (this.app as any).container as Container

    // Register overrides first - module loader skips existing tokens
    for (const [token, value] of this.overrides) {
      const factory = typeof value === 'function' && !value.prototype ? (value as () => any) : () => value
      container.register(token, factory, 'singleton')
    }

    // Register explicit providers (for unit tests without modules)
    for (const provider of this.providers) {
      if (typeof provider === 'function') {
        container.register(provider, () => new provider(), 'singleton')
      } else {
        container.register(provider.token, provider.factory, provider.scope)
      }
    }

    // Load modules (if any)
    if (this.modules.length > 0) {
      this.app.register(...this.modules)
    }

    await this.app.init()
    return this
  }

  async request(
    method: string,
    path: string,
    options?: {
      body?: any
      headers?: Record<string, string>
      query?: Record<string, string>
    },
  ): Promise<Response> {
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
    return this.app.fetch(new Request(url, init))
  }

  resolve<T>(token: Constructor<T> | string): T {
    return this.app.get<T>(token)
  }

  async close(): Promise<void> {
    await this.app.destroy()
  }
}
