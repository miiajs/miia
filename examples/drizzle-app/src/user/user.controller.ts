import { Controller, Get, Post, Put, Delete, Status, ValidateBody, inject } from '@miiajs/core'
import type { RequestContext } from '@miiajs/core'
import type { z } from 'zod'
import { UserService } from './user.service'
import { CreateUserSchema, UpdateUserSchema } from './schemas'

type CreateUserInput = z.infer<typeof CreateUserSchema>
type UpdateUserInput = z.infer<typeof UpdateUserSchema>

@Controller('/users')
export class UserController {
  private userService = inject(UserService)

  @Get('/')
  async findAll(_ctx: RequestContext) {
    return this.userService.findAll()
  }

  @Get('/:id')
  async findOne(ctx: RequestContext) {
    return this.userService.findById(Number(ctx.params.id))
  }

  @Post('/')
  @Status(201)
  @ValidateBody(CreateUserSchema)
  async create(ctx: RequestContext) {
    return this.userService.create(await ctx.json<CreateUserInput>())
  }

  @Put('/:id')
  @ValidateBody(UpdateUserSchema)
  async update(ctx: RequestContext) {
    return this.userService.update(Number(ctx.params.id), await ctx.json<UpdateUserInput>())
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    const deleted = await this.userService.delete(Number(ctx.params.id))
    return { deleted }
  }
}
