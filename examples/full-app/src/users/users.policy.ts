import { ForbiddenException, Injectable } from '@miiajs/core'
import type { User } from './users.schema.js'
import type { UpdateUserInput } from './schemas/index.js'

@Injectable()
export class UsersPolicy {
  assertCanUpdate(actor: User, targetId: number, patch: UpdateUserInput): void {
    const isAdmin = actor.role === 'admin'
    const isSelf = actor.id === targetId

    if (!isAdmin && !isSelf) {
      throw new ForbiddenException('Cannot modify another user')
    }
    if (!isAdmin && patch.role !== undefined) {
      throw new ForbiddenException('Only admins can change roles')
    }
  }
}
