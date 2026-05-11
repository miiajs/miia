import type { Feature } from '../types.js'

export const jwtAuthFeature: Feature = {
  id: 'jwt-auth',
  label: 'JWT Auth',
  hint: 'JWT authentication strategy',
  group: 'core',
  packages: {
    '@miiajs/auth': '^0.1.0',
    '@miiajs/jwt': '^0.1.0',
  },
  requires: ['config'],
  moduleImport: {
    statement: `import { JwtModule } from '@miiajs/jwt'
import { AuthModule } from '../auth/auth.module.js'`,
    entries: [
      `JwtModule.configure((resolve) => ({
      secret: resolve(ConfigService).getOrThrow('JWT_SECRET'),
      expiresIn: '1h',
    }))`,
      `AuthModule`,
    ],
  },
  files: () => ({
    'src/types/core.d.ts': `export {}

declare module '@miiajs/core' {
  interface RequestContext {
    user?: Record<string, unknown>
  }
}
`,
    'src/auth/auth.module.ts': `import { Module } from '@miiajs/core'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { JwtAuth } from './strategies/jwt.strategy.js'
import { LocalAuth } from './strategies/local.strategy.js'

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtAuth, LocalAuth],
})
export class AuthModule {}
`,
    'src/auth/auth.service.ts': `import { Injectable, inject } from '@miiajs/core'
import { JwtService } from '@miiajs/jwt'

@Injectable()
export class AuthService {
  private jwtService = inject(JwtService)

  async issueTokenFor(user: Record<string, unknown>) {
    const token = await this.jwtService.sign({ sub: user.id ?? user.email })
    return { accessToken: token }
  }
}
`,
    'src/auth/auth.controller.ts': `import { Controller, Get, Post, inject, UseGuard } from '@miiajs/core'
import type { RequestContext } from '@miiajs/core'
import { AuthGuard } from '@miiajs/auth'
import { AuthService } from './auth.service.js'
import { JwtAuth } from './strategies/jwt.strategy.js'
import { LocalAuth } from './strategies/local.strategy.js'

@Controller('/auth')
export class AuthController {
  private authService = inject(AuthService)

  @Post('/login')
  @UseGuard(AuthGuard(LocalAuth))
  async login(ctx: RequestContext) {
    return this.authService.issueTokenFor(ctx.user!)
  }

  @Get('/me')
  @UseGuard(AuthGuard(JwtAuth))
  me(ctx: RequestContext) {
    return ctx.user
  }
}
`,
    'src/auth/strategies/jwt.strategy.ts': `import { type AuthProvider, fromHeader } from '@miiajs/auth'
import { inject, Injectable, type RequestContext, UnauthorizedException } from '@miiajs/core'
import { JwtService } from '@miiajs/jwt'

@Injectable()
export class JwtAuth implements AuthProvider {
  private jwtService = inject(JwtService)
  private extract = fromHeader()

  async authenticate(ctx: RequestContext) {
    const token = this.extract(ctx)
    if (!token) throw new UnauthorizedException('Missing token')
    return this.jwtService.verify(token)
  }
}
`,
    'src/auth/strategies/local.strategy.ts': `import { Injectable, UnauthorizedException } from '@miiajs/core'
import type { AuthProvider } from '@miiajs/auth'
import type { RequestContext } from '@miiajs/core'

@Injectable()
export class LocalAuth implements AuthProvider {
  async authenticate(ctx: RequestContext) {
    const body = await ctx.json<{ email: string; password: string }>()
    // TODO: look up user and verify password
    if (!body.email || !body.password) {
      throw new UnauthorizedException('Invalid credentials')
    }
    return { email: body.email }
  }
}
`,
  }),
  envVars: {
    JWT_SECRET: 'change_me_in_production',
  },
}
