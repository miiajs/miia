import { inject, Injectable, NotFoundException } from '@miiajs/core'
import { and, count, desc, eq, type SQL } from 'drizzle-orm'
import { db } from '../db.js'
import { type NewPost, posts } from './posts.schema.js'
import type { ListPostsQuery, UpdatePostInput } from './schemas/index.js'

@Injectable()
export class PostsService {
  private db = inject(db)

  public async findById(id: number) {
    const [post] = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1)
    if (!post) throw new NotFoundException(`Post ${id} not found`)
    return post
  }

  public async create(input: NewPost) {
    const [post] = await this.db.insert(posts).values(input).returning()
    return post
  }

  public async update(id: number, input: UpdatePostInput) {
    const [post] = await this.db
      .update(posts)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(posts.id, id))
      .returning()
    if (!post) throw new NotFoundException(`Post ${id} not found`)
    return post
  }

  public async remove(id: number) {
    const [post] = await this.db.delete(posts).where(eq(posts.id, id)).returning()
    if (!post) throw new NotFoundException(`Post ${id} not found`)
    return post
  }

  public async findAll({ page, limit, authorId, published }: ListPostsQuery) {
    const conditions: SQL[] = []
    if (authorId !== undefined) conditions.push(eq(posts.authorId, authorId))
    if (published !== undefined) conditions.push(eq(posts.published, published))
    const where = conditions.length ? and(...conditions) : undefined
    const offset = (page - 1) * limit
    const [items, [{ total }]] = await Promise.all([
      this.db.select().from(posts).where(where).orderBy(desc(posts.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(posts).where(where),
    ])
    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  }
}
