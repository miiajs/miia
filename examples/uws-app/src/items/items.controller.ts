import {
  Controller,
  Delete,
  Get,
  inject,
  NotFoundException,
  Post,
  Put,
  Status,
  ValidateBody,
  type RequestContext,
} from '@miiajs/core'
import type { z } from 'zod'
import { CreateItemSchema, UpdateItemSchema } from './schemas/index.js'
import { ItemsService } from './items.service.js'

type CreateItemInput = z.infer<typeof CreateItemSchema>
type UpdateItemInput = z.infer<typeof UpdateItemSchema>

@Controller('/items')
export class ItemsController {
  private items = inject(ItemsService)

  @Get('/')
  findAll() {
    return this.items.findAll()
  }

  @Get('/:id')
  findOne(ctx: RequestContext) {
    const item = this.items.findById(ctx.params.id!)
    if (!item) throw new NotFoundException(`Item ${ctx.params.id} not found`)
    return item
  }

  @Post('/')
  @Status(201)
  @ValidateBody(CreateItemSchema)
  async create(ctx: RequestContext) {
    return this.items.create(await ctx.json<CreateItemInput>())
  }

  @Put('/:id')
  @ValidateBody(UpdateItemSchema)
  async update(ctx: RequestContext) {
    const updated = this.items.update(ctx.params.id!, await ctx.json<UpdateItemInput>())
    if (!updated) throw new NotFoundException(`Item ${ctx.params.id} not found`)
    return updated
  }

  @Delete('/:id')
  remove(ctx: RequestContext) {
    const deleted = this.items.delete(ctx.params.id!)
    if (!deleted) throw new NotFoundException(`Item ${ctx.params.id} not found`)
    return { deleted }
  }
}
