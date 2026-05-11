import type { RequestContext } from '@miiajs/core'
import { Controller, Delete, Get, inject, Patch, Post, Status, ValidateBody } from '@miiajs/core'
import { UserService } from './user.service'
import { type CreateUserInput, CreateUserSchema, type UpdateUserInput, UpdateUserSchema } from './schemas'

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

  @Get('/:id')
  async findOne(ctx: RequestContext) {
    return this.userService.findById(ctx.params.id)
  }

  @Post('/')
  @Status(201)
  @ValidateBody(CreateUserSchema)
  async create(ctx: RequestContext) {
    return this.userService.create(await ctx.json<CreateUserInput>())
  }

  @Patch('/:id')
  @ValidateBody(UpdateUserSchema)
  async update(ctx: RequestContext) {
    return this.userService.update(ctx.params.id, await ctx.json<UpdateUserInput>())
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    const deleted = await this.userService.delete(ctx.params.id)
    return { deleted }
  }
}
