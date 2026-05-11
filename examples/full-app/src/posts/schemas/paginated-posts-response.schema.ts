import { z } from 'zod'
import { PostResponseSchema } from './post-response.schema.js'

export const PaginatedPostsResponseSchema = z.object({
  items: z.array(PostResponseSchema),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
})

export type PaginatedPostsResponse = z.infer<typeof PaginatedPostsResponseSchema>
