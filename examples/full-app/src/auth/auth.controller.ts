import { Controller, Get, inject, Post, type RequestContext, Status, UseGuard, ValidateBody } from '@miiajs/core'
import { ApiBody, ApiOperation, ApiResponse, ApiSecurity, ApiTag } from '@miiajs/swagger'
import { AuthService } from './auth.service.js'
import { type RegisterInput, RegisterSchema } from './schemas/register.schema.js'
import { LoginSchema } from './schemas/login.schema.js'
import { AccessTokenResponseSchema } from './schemas/access-token-response.schema.js'
import { UserResponseSchema } from '../users/schemas/index.js'
import { AuthGuard } from '@miiajs/auth'
import { JwtAuth, JwtCookieAuth, LocalAuth } from './providers/index.js'
import { RateLimit } from '@miiajs/rate-limit'

@Controller('auth')
@ApiTag('Auth')
export class AuthController {
  private authService = inject(AuthService)

  @Post('register')
  @ApiOperation({ summary: 'Register a new user', description: 'Creates a user account with the default "user" role.' })
  @ApiResponse(201, { description: 'Created user record (without password hash).', schema: UserResponseSchema })
  @ApiResponse(409, { description: 'Email already registered.' })
  @Status(201)
  @ValidateBody(RegisterSchema)
  async register(ctx: RequestContext) {
    const data = await ctx.json<RegisterInput>()
    return this.authService.register(data)
  }

  @Post('/login')
  @ApiOperation({
    summary: 'Exchange credentials for a JWT',
    description: 'Accepts email/password via the Local strategy and returns an access token on success.',
  })
  @ApiBody(LoginSchema)
  @ApiResponse(200, { description: 'Access token envelope.', schema: AccessTokenResponseSchema })
  @ApiResponse(401, { description: 'Invalid credentials.' })
  @UseGuard(AuthGuard(LocalAuth))
  @RateLimit({ limit: 5, window: '1m', blockDuration: '10s', blockBackoff: 2, maxBlockDuration: '5m' })
  async login(ctx: RequestContext) {
    const accessToken = await this.authService.issueTokenFor(ctx.user!)
    return { accessToken }
  }

  @Get('me')
  @ApiOperation({ summary: 'Current user', description: 'Returns the authenticated user derived from the JWT.' })
  @ApiResponse(200, { description: 'Authenticated user record.', schema: UserResponseSchema })
  @ApiResponse(401, { description: 'Missing or invalid token.' })
  @ApiSecurity('bearer')
  @UseGuard(AuthGuard(JwtAuth))
  me(ctx: RequestContext) {
    return ctx.user
  }

  @Post('/login-cookie')
  @ApiOperation({
    summary: 'Log in and set a session cookie',
    description: 'Validates credentials via the Local strategy and stores the JWT in an httpOnly cookie.',
  })
  @ApiBody(LoginSchema)
  @ApiResponse(200, { description: 'Session cookie set.' })
  @ApiResponse(401, { description: 'Invalid credentials.' })
  @UseGuard(AuthGuard(LocalAuth))
  @RateLimit({ limit: 5, window: '1m', blockDuration: '10s', blockBackoff: 2, maxBlockDuration: '5m' })
  async loginCookie(ctx: RequestContext) {
    const token = await this.authService.issueTokenFor(ctx.user!)
    // set secure: true in production behind HTTPS.
    ctx.res.cookie('access_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 3600, path: '/' })
    return { ok: true }
  }

  @Get('/me-cookie')
  @ApiOperation({
    summary: 'Current user via session cookie',
    description: 'Authorizes from the access_token cookie instead of the Authorization header.',
  })
  @ApiResponse(200, { description: 'Authenticated user record.', schema: UserResponseSchema })
  @ApiResponse(401, { description: 'Missing or invalid session cookie.' })
  @UseGuard(AuthGuard(JwtCookieAuth))
  meCookie(ctx: RequestContext) {
    return ctx.user
  }

  @Post('/logout')
  @ApiOperation({ summary: 'Log out', description: 'Clears the access_token session cookie.' })
  @ApiResponse(200, { description: 'Session cookie cleared.' })
  logout(ctx: RequestContext) {
    ctx.res.deleteCookie('access_token')
    return { ok: true }
  }
}
