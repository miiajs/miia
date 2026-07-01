import { Miia } from '@miiajs/core'
import type { ConfiguredModule, Constructor, Guard, Middleware, ProviderDefinition } from '@miiajs/core'

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
    // Register overrides first - module loader skips existing tokens
    for (const [token, value] of this.overrides) {
      const factory = typeof value === 'function' && !value.prototype ? (value as () => any) : () => value
      this.app.provide({ token, factory, scope: 'singleton' })
    }

    // Register explicit providers (for unit tests without modules)
    this.app.provide(...this.providers)

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
      ip?: string
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
    const req = new Request(url, init)
    if (options?.ip !== undefined) (req as any)._conn = { remoteAddress: options.ip }
    return this.app.fetch(req)
  }

  resolve<T>(token: Constructor<T> | string): T {
    return this.app.get<T>(token)
  }

  async close(): Promise<void> {
    await this.app.destroy()
  }
}
