import { Module } from '@miiajs/core'
import { PostsController } from './posts.controller.js'
import { PostsService } from './posts.service.js'
import { PostsPolicy } from './posts.policy.js'

@Module({
  controllers: [PostsController],
  providers: [PostsService, PostsPolicy],
})
export class PostsModule {}
