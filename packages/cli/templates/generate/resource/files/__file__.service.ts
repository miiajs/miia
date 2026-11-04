import { Injectable, NotFoundException } from '@miiajs/core'
import type { __Name__ } from './__file__.types.js'
import type { Create__Name__Input } from './schemas/create-__file__.schema.js'
import type { Update__Name__Input } from './schemas/update-__file__.schema.js'

// In-memory store: replace it with your database
@Injectable()
export class __Name__Service {
  private readonly items = new Map<string, __Name__>()

  create(input: Create__Name__Input): __Name__ {
    const item = { id: crypto.randomUUID(), ...input }
    this.items.set(item.id, item)
    return item
  }

  findAll(): __Name__[] {
    return [...this.items.values()]
  }

  findOne(id: string): __Name__ {
    const item = this.items.get(id)
    if (!item) throw new NotFoundException(`__Name__ ${id} not found`)
    return item
  }

  update(id: string, input: Update__Name__Input): __Name__ {
    const item = { ...this.findOne(id), ...input }
    this.items.set(id, item)
    return item
  }

  remove(id: string): void {
    this.findOne(id)
    this.items.delete(id)
  }
}
