import {
  Controller,
  Delete,
  Get,
  inject,
  NotFoundException,
  Patch,
  Post,
  type RequestContext,
  Status,
} from '@miiajs/core'
import { UserService } from './user.service'
import {
  type CreateUserInput,
  CreateUserSchema,
  type UpdateUserInput,
  UpdateUserSchema,
  UserIdParamsSchema,
} from './schemas'

@Controller('/users')
export class UserController {
  private userService = inject(UserService)

  @Get('/')
  async findAll(_ctx: RequestContext) {
    return this.userService.findAll()
  }

  @Get('/stats')
  async stats(_ctx: RequestContext) {
    return this.userService.stats()
  }

  @Get('/:id', { params: UserIdParamsSchema })
  async findOne(ctx: RequestContext) {
    const user = await this.userService.findById(ctx.params.id)
    if (!user) throw new NotFoundException(`User ${ctx.params.id} not found`)
    return user
  }

  @Post('/', { body: CreateUserSchema })
  @Status(201)
  async create(ctx: RequestContext) {
    return this.userService.create(await ctx.json<CreateUserInput>())
  }

  @Patch('/:id', { params: UserIdParamsSchema, body: UpdateUserSchema })
  async update(ctx: RequestContext) {
    const user = await this.userService.update(ctx.params.id, await ctx.json<UpdateUserInput>())
    if (!user) throw new NotFoundException(`User ${ctx.params.id} not found`)
    return user
  }

  @Delete('/:id', { params: UserIdParamsSchema })
  async remove(ctx: RequestContext) {
    const deleted = await this.userService.delete(ctx.params.id)
    if (!deleted) throw new NotFoundException(`User ${ctx.params.id} not found`)
    return { deleted }
  }
}
