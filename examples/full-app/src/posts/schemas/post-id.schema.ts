import { z } from 'zod'

export const PostIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export type PostIdParams = z.infer<typeof PostIdParamsSchema>
