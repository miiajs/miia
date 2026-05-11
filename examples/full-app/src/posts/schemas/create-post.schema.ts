import { z } from 'zod'

export const CreatePostSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().default(''),
  published: z.boolean().default(false),
})

export type CreatePostInput = z.infer<typeof CreatePostSchema>
