import { Injectable } from '@miiajs/core'
import { randomUUID } from 'node:crypto'

export interface Item {
  id: string
  name: string
  price: number
}

@Injectable()
export class ItemsService {
  private items = new Map<string, Item>()

  findAll(): Item[] {
    return Array.from(this.items.values())
  }

  findById(id: string): Item | undefined {
    return this.items.get(id)
  }

  create(data: { name: string; price: number }): Item {
    const item: Item = { id: randomUUID(), ...data }
    this.items.set(item.id, item)
    return item
  }

  update(id: string, data: { name?: string; price?: number }): Item | undefined {
    const existing = this.items.get(id)
    if (!existing) return undefined
    const updated = { ...existing, ...data }
    this.items.set(id, updated)
    return updated
  }

  delete(id: string): boolean {
    return this.items.delete(id)
  }
}
