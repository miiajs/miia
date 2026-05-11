import { z } from 'zod'

export const PostResponseSchema = z.object({
  id: z.number().int().positive(),
  authorId: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
  published: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type PostResponse = z.infer<typeof PostResponseSchema>
