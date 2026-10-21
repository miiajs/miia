import { z } from 'zod'

// posts.id is a Postgres serial, a 4-byte integer
export const PostIdParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2_147_483_647),
})

export type PostIdParams = z.infer<typeof PostIdParamsSchema>
