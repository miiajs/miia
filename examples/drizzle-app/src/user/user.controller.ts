import { Controller, Get, Post, Put, Delete, Status, inject, NotFoundException } from '@miiajs/core'
import type { RequestContext } from '@miiajs/core'
import type { z } from 'zod'
import { UserService } from './user.service'
import { CreateUserSchema, UpdateUserSchema, type UserIdParams, UserIdParamsSchema } from './schemas'

type CreateUserInput = z.infer<typeof CreateUserSchema>
type UpdateUserInput = z.infer<typeof UpdateUserSchema>

@Controller('/users')
export class UserController {
  private userService = inject(UserService)

  @Get('/')
  async findAll(_ctx: RequestContext) {
    return this.userService.findAll()
  }

  @Get('/:id', { params: UserIdParamsSchema })
  async findOne(ctx: RequestContext) {
    const { id } = ctx.params as UserIdParams
    const user = await this.userService.findById(id)
    if (!user) throw new NotFoundException(`User ${id} not found`)
    return user
  }

  @Post('/', { body: CreateUserSchema })
  @Status(201)
  async create(ctx: RequestContext) {
    return this.userService.create(await ctx.json<CreateUserInput>())
  }

  @Put('/:id', { params: UserIdParamsSchema, body: UpdateUserSchema })
  async update(ctx: RequestContext) {
    const { id } = ctx.params as UserIdParams
    const user = await this.userService.update(id, await ctx.json<UpdateUserInput>())
    if (!user) throw new NotFoundException(`User ${id} not found`)
    return user
  }

  @Delete('/:id', { params: UserIdParamsSchema })
  async remove(ctx: RequestContext) {
    const { id } = ctx.params as UserIdParams
    const deleted = await this.userService.delete(id)
    if (!deleted) throw new NotFoundException(`User ${id} not found`)
    return { deleted }
  }
}
