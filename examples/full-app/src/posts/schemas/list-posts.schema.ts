import { z } from 'zod'

export const ListPostsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  authorId: z.coerce.number().int().positive().optional(),
  published: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
})

export type ListPostsQuery = z.infer<typeof ListPostsSchema>
