import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DiscoveryService, Injectable, RESOLVED_PREFIX, Router, inject } from '@miiajs/core'
import { createStaticHandler } from '@miiajs/serve-static'
import { SpecBuilder, type DiscoveredController } from './builder/index.js'
import { SWAGGER_OPTIONS } from './swagger.module.js'
import { buildSwaggerInitializer } from './swagger-ui.js'

const swaggerUiDistPath = dirname(fileURLToPath(import.meta.resolve('swagger-ui-dist/package.json')))

@Injectable({ hint: 'SwaggerModule.configure()' })
export class SwaggerService {
  private discovery = inject(DiscoveryService)
  private router = inject(Router)
  private options = inject(SWAGGER_OPTIONS)

  async onReady(): Promise<void> {
    const controllers = this.collectControllers()
    const spec = new SpecBuilder().build(controllers, this.options, this.router.globalGuards ?? [])
    const specJson = JSON.stringify(spec)

    const specPath = this.options.path ?? '/docs/json'
    const uiPath = this.options.uiPath ?? '/docs'

    // NOTE: routes registered here bypass router.compileAll() - it already ran
    // in compilePipelines() before bootstrapAll(), so `compiledPipeline` stays
    // undefined and no per-route guards are grafted on. Global middleware from
    // `app.use()` still wraps the dispatch (cors, logger, request-id on /docs
    // is desirable). `skipGlobalGuards: true` is kept as a semantic marker: the
    // pipelines are compiled once per app and app.addRoute() after init() throws,
    // so nothing recompiles them today, but these endpoints must never carry
    // global guards should compileAll() ever run over them.
    //
    // `skipGlobalPrefix: true` keeps the docs endpoints outside the app's global
    // prefix: `path` and `uiPath` are already the absolute URLs the user configured,
    // and the spec never carries the prefix either, so the two stay consistent.
    this.router.add(
      'GET',
      specPath,
      () => new Response(specJson, { headers: { 'Content-Type': 'application/json' } }),
      { skipGlobalGuards: true, skipGlobalPrefix: true },
    )

    if (this.options.ui !== false) {
      const initializer = buildSwaggerInitializer(specPath, this.options.swaggerOptions)
      this.router.add(
        'GET',
        `${uiPath}/swagger-initializer.js`,
        () => new Response(initializer, { headers: { 'Content-Type': 'application/javascript' } }),
        { skipGlobalGuards: true, skipGlobalPrefix: true },
      )
      this.router.add('GET', `${uiPath}/*`, createStaticHandler(swaggerUiDistPath, { maxAge: 3600 }), {
        skipGlobalGuards: true,
        skipGlobalPrefix: true,
      })
    }
  }

  private collectControllers(): DiscoveredController[] {
    return this.discovery
      .getClassesWithMeta<string>(RESOLVED_PREFIX)
      .map(({ ctor, metadata }) => ({ controller: ctor, prefix: metadata }))
  }
}
