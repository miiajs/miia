import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BadRequestException, inject, Injectable, Logger, NotFoundException } from '@miiajs/core'
import { hash } from '@node-rs/argon2'
import { db } from '../db.js'
import { type NewUser, publicUserColumns, users } from './users.schema.js'
import { count, desc, eq } from 'drizzle-orm'
import type { ListUsersQuery, UpdateUserInput } from './schemas/index.js'
import { ConfigService } from '@miiajs/config'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const AVATAR_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}

const SEED_ADMIN_EMAIL = 'admin@miiajs.com'
const SEED_ADMIN_PASSWORD = 'admin'

@Injectable()
export class UsersService {
  private db = inject(db)
  private logger = new Logger('UsersService')
  private configService = inject(ConfigService)

  async onReady(): Promise<void> {
    if (this.configService.get('NODE_ENV') === 'production') return
    const existing = await this.findByEmail(SEED_ADMIN_EMAIL)
    if (existing) return
    await this.create({
      email: SEED_ADMIN_EMAIL,
      role: 'admin',
      passwordHash: await hash(SEED_ADMIN_PASSWORD),
    })
    this.logger.log(`Seeded admin user (${SEED_ADMIN_EMAIL} / ${SEED_ADMIN_PASSWORD})`)
  }

  public async findByEmail(email: string) {
    const [user] = await this.db.select(publicUserColumns).from(users).where(eq(users.email, email)).limit(1)
    return user
  }

  public async findByEmailForAuth(email: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1)
    return user
  }

  public async findById(id: number) {
    const [user] = await this.db.select(publicUserColumns).from(users).where(eq(users.id, id)).limit(1)
    if (!user) throw new NotFoundException(`User ${id} not found`)
    return user
  }

  public async create(input: NewUser) {
    const [user] = await this.db.insert(users).values(input).returning(publicUserColumns)
    return user
  }

  public async remove(id: number) {
    const [user] = await this.db.delete(users).where(eq(users.id, id)).returning(publicUserColumns)
    if (!user) throw new NotFoundException(`User ${id} not found`)
    return user
  }

  public async update(id: number, input: UpdateUserInput) {
    const [user] = await this.db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning(publicUserColumns)
    if (!user) throw new NotFoundException(`User ${id} not found`)
    return user
  }

  public async uploadAvatar(id: number, file: File) {
    await this.findById(id)

    if (file.size > MAX_AVATAR_BYTES) {
      throw new BadRequestException(`File too large (max ${MAX_AVATAR_BYTES} bytes)`)
    }
    const ext = AVATAR_EXTENSIONS[file.type]
    if (!ext) {
      throw new BadRequestException(`Unsupported file type: ${file.type || 'unknown'}`)
    }

    const filename = `${id}-${randomUUID()}${ext}`
    const dir = resolve(process.cwd(), 'public', 'avatars')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, filename), new Uint8Array(await file.arrayBuffer()))

    const avatarUrl = `/static/avatars/${filename}`
    // Old avatar file is intentionally left on disk - example simplicity.
    const [user] = await this.db
      .update(users)
      .set({ avatarUrl, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning(publicUserColumns)
    if (!user) throw new NotFoundException(`User ${id} not found`)
    return user
  }

  public async findAll({ page, limit }: ListUsersQuery) {
    const offset = (page - 1) * limit
    const [items, [{ total }]] = await Promise.all([
      this.db.select(publicUserColumns).from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(users),
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
