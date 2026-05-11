import {
  Controller,
  Delete,
  Get,
  inject,
  Patch,
  Post as HttpPost,
  type RequestContext,
  Status,
  UnauthorizedException,
  UseGuard,
  ValidateBody,
  ValidateParams,
  ValidateQuery,
} from '@miiajs/core'
import { ApiOperation, ApiResponse, ApiSecurity, ApiTag } from '@miiajs/swagger'
import { AuthGuard } from '@miiajs/auth'
import { JwtAuth } from '../auth/providers/index.js'
import { PostsService } from './posts.service.js'
import { PostsPolicy } from './posts.policy.js'
import {
  type CreatePostInput,
  CreatePostSchema,
  type ListPostsQuery,
  ListPostsSchema,
  PaginatedPostsResponseSchema,
  PostIdParamsSchema,
  PostResponseSchema,
  type UpdatePostInput,
  UpdatePostSchema,
} from './schemas/index.js'

@Controller('posts')
@ApiTag('Posts')
@ApiSecurity('bearer')
@UseGuard(AuthGuard(JwtAuth))
export class PostsController {
  private postsService = inject(PostsService)
  private postsPolicy = inject(PostsPolicy)

  @Get()
  @ApiOperation({
    summary: 'List posts',
    description: 'Returns a paginated list of posts. Supports filtering by authorId and published.',
  })
  @ApiResponse(200, { description: 'Paginated posts envelope.', schema: PaginatedPostsResponseSchema })
  @ValidateQuery(ListPostsSchema)
  findAll(ctx: RequestContext) {
    return this.postsService.findAll(ctx.query as ListPostsQuery)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get post by id' })
  @ApiResponse(200, { description: 'Post record.', schema: PostResponseSchema })
  @ApiResponse(404, { description: 'Post not found.' })
  @ValidateParams(PostIdParamsSchema)
  findOne(ctx: RequestContext) {
    return this.postsService.findById(ctx.params.id)
  }

  @HttpPost()
  @Status(201)
  @ApiOperation({ summary: 'Create post', description: 'Creates a post owned by the authenticated user.' })
  @ApiResponse(201, { description: 'Created post.', schema: PostResponseSchema })
  @ValidateBody(CreatePostSchema)
  async create(ctx: RequestContext) {
    if (!ctx.user) throw new UnauthorizedException()
    const input = await ctx.json<CreatePostInput>()
    return this.postsService.create({ ...input, authorId: ctx.user.id })
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update post',
    description: 'Only the author or an admin can update a post.',
  })
  @ApiResponse(200, { description: 'Updated post.', schema: PostResponseSchema })
  @ApiResponse(403, { description: 'Not the author and not an admin.' })
  @ApiResponse(404, { description: 'Post not found.' })
  @ValidateParams(PostIdParamsSchema)
  @ValidateBody(UpdatePostSchema)
  async update(ctx: RequestContext) {
    if (!ctx.user) throw new UnauthorizedException()
    const existing = await this.postsService.findById(ctx.params.id)
    this.postsPolicy.assertCanModify(ctx.user, existing)
    const input = await ctx.json<UpdatePostInput>()
    return this.postsService.update(ctx.params.id, input)
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete post',
    description: 'Only the author or an admin can delete a post.',
  })
  @ApiResponse(204, { description: 'Post deleted.' })
  @ApiResponse(403, { description: 'Not the author and not an admin.' })
  @ApiResponse(404, { description: 'Post not found.' })
  @Status(204)
  @ValidateParams(PostIdParamsSchema)
  async remove(ctx: RequestContext) {
    if (!ctx.user) throw new UnauthorizedException()
    const existing = await this.postsService.findById(ctx.params.id)
    this.postsPolicy.assertCanModify(ctx.user, existing)
    await this.postsService.remove(ctx.params.id)
  }
}
