import { Injectable, NotFoundException } from '@miiajs/core'
import type { Create__Name__Input, Update__Name__Input } from './__file__.schemas.js'

export interface __Name__ {
  id: number
  name: string
}

// In-memory store: replace it with your database
@Injectable()
export class __Name__Service {
  private readonly items = new Map<number, __Name__>()
  private nextId = 1

  create(input: Create__Name__Input): __Name__ {
    const item = { id: this.nextId++, ...input }
    this.items.set(item.id, item)
    return item
  }

  findAll(): __Name__[] {
    return [...this.items.values()]
  }

  findOne(id: number): __Name__ {
    const item = this.items.get(id)
    if (!item) throw new NotFoundException(`__Name__ ${id} not found`)
    return item
  }

  update(id: number, input: Update__Name__Input): __Name__ {
    const item = { ...this.findOne(id), ...input }
    this.items.set(id, item)
    return item
  }

  remove(id: number): void {
    this.findOne(id)
    this.items.delete(id)
  }
}
