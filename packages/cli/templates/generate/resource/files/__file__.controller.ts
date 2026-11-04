import { Controller, Delete, Get, inject, Patch, Post, type RequestContext, Status } from '@miiajs/core'
import { __Name__Service } from './__file__.service.js'
import { type __Name__IdParams, __Name__IdParamsSchema } from './schemas/__file__-id-params.schema.js'
import { type Create__Name__Input, Create__Name__Schema } from './schemas/create-__file__.schema.js'
import { type Update__Name__Input, Update__Name__Schema } from './schemas/update-__file__.schema.js'

@Controller('/__file__')
export class __Name__Controller {
  private readonly __name__Service = inject(__Name__Service)

  @Post({ body: Create__Name__Schema })
  @Status(201)
  async create(ctx: RequestContext) {
    return this.__name__Service.create(await ctx.json<Create__Name__Input>())
  }

  @Get()
  findAll() {
    return this.__name__Service.findAll()
  }

  @Get(':id', { params: __Name__IdParamsSchema })
  findOne(ctx: RequestContext) {
    return this.__name__Service.findOne((ctx.params as __Name__IdParams).id)
  }

  @Patch(':id', { params: __Name__IdParamsSchema, body: Update__Name__Schema })
  async update(ctx: RequestContext) {
    const { id } = ctx.params as __Name__IdParams
    return this.__name__Service.update(id, await ctx.json<Update__Name__Input>())
  }

  // Without @Status(204) a null result answers 200 with an empty body
  @Delete(':id', { params: __Name__IdParamsSchema })
  @Status(204)
  remove(ctx: RequestContext) {
    this.__name__Service.remove((ctx.params as __Name__IdParams).id)
    return null
  }
}
