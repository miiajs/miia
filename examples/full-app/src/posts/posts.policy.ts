import { ForbiddenException, Injectable } from '@miiajs/core'
import type { User } from '../users/users.schema.js'
import type { Post } from './posts.schema.js'

@Injectable()
export class PostsPolicy {
  assertCanModify(actor: User, post: Post): void {
    const isAdmin = actor.role === 'admin'
    const isOwner = actor.id === post.authorId

    if (!isAdmin && !isOwner) {
      throw new ForbiddenException("Cannot modify another user's post")
    }
  }
}
