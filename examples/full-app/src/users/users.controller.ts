import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  inject,
  Patch,
  Post,
  type RequestContext,
  Status,
  UnauthorizedException,
  UseGuard,
  ValidateBody,
  ValidateParams,
  ValidateQuery,
} from '@miiajs/core'
import { ApiBody, ApiOperation, ApiResponse, ApiSecurity, ApiTag } from '@miiajs/swagger'
import { UsersService } from './users.service.js'
import { UsersPolicy } from './users.policy.js'
import { JwtAuth } from '../auth/providers/index.js'
import { Roles } from '../auth/guards/index.js'
import { AuthGuard } from '@miiajs/auth'
import {
  type ListUsersQuery,
  ListUsersSchema,
  PaginatedUsersResponseSchema,
  type UpdateUserInput,
  UpdateUserSchema,
  UserIdParamsSchema,
  UserResponseSchema,
} from './schemas/index.js'

@Controller('users')
@ApiTag('Users')
@ApiSecurity('bearer')
@UseGuard(AuthGuard(JwtAuth))
export class UsersController {
  private usersService = inject(UsersService)
  private usersPolicy = inject(UsersPolicy)

  @Get()
  @ApiOperation({ summary: 'List users', description: 'Returns a paginated list of users.' })
  @ApiResponse(200, { description: 'Paginated users envelope.', schema: PaginatedUsersResponseSchema })
  @ValidateQuery(ListUsersSchema)
  findAll(ctx: RequestContext) {
    return this.usersService.findAll(ctx.query as ListUsersQuery)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by id' })
  @ApiResponse(200, { description: 'User record.', schema: UserResponseSchema })
  @ApiResponse(404, { description: 'User not found.' })
  @ValidateParams(UserIdParamsSchema)
  findOne(ctx: RequestContext) {
    return this.usersService.findById(ctx.params.id)
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update user',
    description: 'Users can update their own record. Only admins can update other users or change roles.',
  })
  @ApiResponse(200, { description: 'Updated user record.', schema: UserResponseSchema })
  @ApiResponse(403, { description: 'Cannot modify another user, or non-admin tried to change a role.' })
  @ApiResponse(404, { description: 'User not found.' })
  @ValidateParams(UserIdParamsSchema)
  @ValidateBody(UpdateUserSchema)
  async update(ctx: RequestContext) {
    if (!ctx.user) throw new UnauthorizedException()
    const input = await ctx.json<UpdateUserInput>()
    this.usersPolicy.assertCanUpdate(ctx.user, ctx.params.id, input)
    return this.usersService.update(ctx.params.id, input)
  }

  @Post(':id/avatar')
  @ApiOperation({
    summary: 'Upload user avatar',
    description: 'Multipart upload. Field "file". Max 2MB. Allowed MIME: image/png, image/jpeg, image/webp.',
  })
  @ApiBody(
    {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
    { contentType: 'multipart/form-data' },
  )
  @ApiResponse(200, { description: 'Avatar stored. Returns updated user.', schema: UserResponseSchema })
  @ApiResponse(400, { description: 'Invalid or missing file.' })
  @ApiResponse(403, { description: 'Cannot modify another user.' })
  @ApiResponse(404, { description: 'User not found.' })
  @ValidateParams(UserIdParamsSchema)
  async uploadAvatar(ctx: RequestContext) {
    if (!ctx.user) throw new UnauthorizedException()
    this.usersPolicy.assertCanUpdate(ctx.user, ctx.params.id, {})
    let form: FormData
    try {
      form = await ctx.req.formData()
    } catch (err) {
      throw new BadRequestException(
        `Invalid multipart/form-data body: ${err instanceof Error ? err.message : 'parse error'}`,
      )
    }
    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new BadRequestException('Field "file" is required and must be a file')
    }
    return this.usersService.uploadAvatar(ctx.params.id, file)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user', description: 'Admin-only. Removes the user permanently.' })
  @ApiResponse(204, { description: 'User deleted.' })
  @ApiResponse(403, { description: 'Not an admin.' })
  @ApiResponse(404, { description: 'User not found.' })
  @Status(204)
  @Roles('admin')
  @ValidateParams(UserIdParamsSchema)
  async remove(ctx: RequestContext) {
    await this.usersService.remove(ctx.params.id)
  }
}
