import { AuthGuard } from '@miiajs/auth'
import { Controller, Get, inject, Post, type RequestContext, Status, UseGuard } from '@miiajs/core'
import { AuthService } from './auth.service.js'
import { JwtAuth } from './providers/jwt-auth.provider.js'
import { LocalAuth } from './providers/local-auth.provider.js'
import { type RegisterInput, RegisterSchema } from './schemas/register.schema.js'

@Controller('/auth')
export class AuthController {
  private readonly authService = inject(AuthService)

  @Post('/register', { body: RegisterSchema })
  @Status(201)
  async register(ctx: RequestContext) {
    return this.authService.register(await ctx.json<RegisterInput>())
  }

  @Post('/login')
  @UseGuard(AuthGuard(LocalAuth))
  login(ctx: RequestContext) {
    return this.authService.issueTokenFor(ctx.user!)
  }

  @Get('/me')
  @UseGuard(AuthGuard(JwtAuth))
  me(ctx: RequestContext) {
    return ctx.user
  }
}
