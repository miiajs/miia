import { z } from 'zod'

export const UpdateUserSchema = z
  .object({
    name: z.string().min(2).max(255).optional(),
    role: z.enum(['user', 'admin']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' })

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>
