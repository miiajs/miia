import { describe, it, expect } from 'bun:test'
import { composeAppModule, composeMainTs } from '../src/scaffold/app-composer.js'
import { resolveFeatures } from '../src/scaffold/features/registry.js'

describe('composeAppModule', () => {
  it('emits each feature entry without mangling indentation', () => {
    const { features } = resolveFeatures(['config', 'jwt-auth', 'swagger', 'drizzle-postgres'])
    const out = composeAppModule({ runtime: 'bun', features })

    expect(out).toContain(`import { ConfigModule } from '@miiajs/config'`)
    expect(out).toContain(`import { JwtModule } from '@miiajs/jwt'`)
    expect(out).toContain(`import { AuthModule } from '../auth/auth.module.js'`)
    expect(out).toContain(`import { SwaggerModule } from '@miiajs/swagger'`)
    expect(out).toContain(`import { DrizzleModule } from '@miiajs/drizzle'`)
    expect(out).toContain(`import { ConfigService } from '@miiajs/config'`)

    expect(out).toContain(`      secret: resolve(ConfigService).getOrThrow('JWT_SECRET')`)
    expect(out).toContain(`      expiresIn: '1h'`)
    expect(out).toContain(`      title: 'My App'`)
    expect(out).toContain(`      dialect: 'postgres'`)

    expect(out).toMatch(/AuthModule,\n\s+SwaggerModule\.configure/)
  })

  it('omits imports block when no features have moduleImport', () => {
    const { features } = resolveFeatures(['cors'])
    const out = composeAppModule({ runtime: 'bun', features })
    expect(out).not.toContain('imports:')
    expect(out).toContain('controllers: [AppController]')
  })

  it('detects ConfigService via entries', () => {
    const { features } = resolveFeatures(['config', 'mongoose'])
    const out = composeAppModule({ runtime: 'bun', features })
    expect(out).toContain(`import { ConfigService } from '@miiajs/config'`)
  })
})

describe('composeMainTs', () => {
  it('includes node-server import for node runtime', () => {
    const { features } = resolveFeatures([])
    const out = composeMainTs({ runtime: 'node', features })
    expect(out).toContain(`@miiajs/node-server`)
    expect(out).toContain(`await app.listen(3000, '0.0.0.0', serve)`)
  })

  it('omits node-server for bun runtime', () => {
    const { features } = resolveFeatures([])
    const out = composeMainTs({ runtime: 'bun', features })
    expect(out).not.toContain(`@miiajs/node-server`)
    expect(out).toContain(`await app.listen(3000, '0.0.0.0')`)
  })

  it('inserts cors before listen', () => {
    const { features } = resolveFeatures(['cors'])
    const out = composeMainTs({ runtime: 'bun', features })
    expect(out).toMatch(/app\.use\(\s*cors\([\s\S]*app\.listen/)
  })

  it('reads PORT and HOST from ConfigService when config feature is enabled', () => {
    const { features } = resolveFeatures(['config'])
    const out = composeMainTs({ runtime: 'bun', features })
    expect(out).toContain(`import { ConfigService } from '@miiajs/config'`)
    expect(out).toContain(`import type { Env } from './env.schema.js'`)
    expect(out).toContain(`const configService = app.get(ConfigService<Env>)`)
    expect(out).toContain(`const port = configService.get('PORT')`)
    expect(out).toContain(`const host = configService.get('HOST')`)
    expect(out).toContain(`await app.listen(port, host)`)
  })

  it('uses ConfigService-derived port/host with node adapter', () => {
    const { features } = resolveFeatures(['config'])
    const out = composeMainTs({ runtime: 'node', features })
    expect(out).toContain(`await app.listen(port, host, serve)`)
  })
})
