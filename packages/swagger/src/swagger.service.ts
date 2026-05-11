import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DiscoveryService, Injectable, RESOLVED_PREFIX, Router, getMeta, inject, type Constructor } from '@miiajs/core'
import { createStaticHandler } from '@miiajs/serve-static'
import { SpecBuilder, type DiscoveredController } from './builder/index.js'
import { SWAGGER_OPTIONS } from './swagger.module.js'
import { buildSwaggerInitializer } from './swagger-ui.js'
import type { SwaggerSetupOptions } from './types.js'

const swaggerUiDistPath = dirname(fileURLToPath(import.meta.resolve('swagger-ui-dist/package.json')))

@Injectable()
export class SwaggerService {
  private discovery = inject(DiscoveryService)
  private router = inject(Router)
  private options = inject<SwaggerSetupOptions>(SWAGGER_OPTIONS)

  async onReady(): Promise<void> {
    const controllers = this.collectControllers()
    const spec = new SpecBuilder().build(controllers, this.options)
    const specJson = JSON.stringify(spec)

    const specPath = this.options.path ?? '/docs/json'
    const uiPath = this.options.uiPath ?? '/docs'

    // NOTE: routes registered here bypass router.compileAll() - it already ran
    // in compilePipelines() before bootstrapAll(), so `compiledPipeline` stays
    // undefined and no per-route guards are grafted on. Global middleware from
    // `app.use()` still wraps the dispatch (cors, logger, request-id on /docs
    // is desirable). `skipGlobalGuards: true` is kept as a semantic marker +
    // safety net: if the user later calls app.addRoute() (flipping compiled=false),
    // a subsequent compilePipelines() re-runs compileAll across all entries, and
    // this flag ensures global auth guards still don't graft onto swagger endpoints.
    this.router.add(
      'GET',
      specPath,
      () => new Response(specJson, { headers: { 'Content-Type': 'application/json' } }),
      { skipGlobalGuards: true },
    )

    if (this.options.ui !== false) {
      const initializer = buildSwaggerInitializer(specPath, this.options.swaggerOptions)
      this.router.add(
        'GET',
        `${uiPath}/swagger-initializer.js`,
        () => new Response(initializer, { headers: { 'Content-Type': 'application/javascript' } }),
        { skipGlobalGuards: true },
      )
      this.router.add('GET', `${uiPath}/*`, createStaticHandler(swaggerUiDistPath, { maxAge: 3600 }), {
        skipGlobalGuards: true,
      })
    }
  }

  private collectControllers(): DiscoveredController[] {
    const result: DiscoveredController[] = []
    for (const { ctor } of this.discovery.getSingletons()) {
      const prefix = getMeta<string>(ctor, RESOLVED_PREFIX)
      if (prefix !== undefined) result.push({ controller: ctor as Constructor, prefix })
    }
    return result
  }
}
