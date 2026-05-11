import { z } from 'zod'

export const UpdatePostSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    content: z.string().optional(),
    published: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' })

export type UpdatePostInput = z.infer<typeof UpdatePostSchema>
