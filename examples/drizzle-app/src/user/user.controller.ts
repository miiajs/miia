import { Controller, Get, Post, Put, Delete, Status, inject, NotFoundException } from '@miiajs/core'
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
    const user = await this.userService.findById(Number(ctx.params.id))
    if (!user) throw new NotFoundException(`User ${ctx.params.id} not found`)
    return user
  }

  @Post('/', { body: CreateUserSchema })
  @Status(201)
  async create(ctx: RequestContext) {
    return this.userService.create(await ctx.json<CreateUserInput>())
  }

  @Put('/:id', { body: UpdateUserSchema })
  async update(ctx: RequestContext) {
    const user = await this.userService.update(Number(ctx.params.id), await ctx.json<UpdateUserInput>())
    if (!user) throw new NotFoundException(`User ${ctx.params.id} not found`)
    return user
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    const deleted = await this.userService.delete(Number(ctx.params.id))
    if (!deleted) throw new NotFoundException(`User ${ctx.params.id} not found`)
    return { deleted }
  }
}
