import { z } from 'zod'

export const UserResponseSchema = z.object({
  id: z.number().int().positive(),
  email: z.email(),
  name: z.string(),
  role: z.enum(['admin', 'user', 'guest']),
  avatarUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type UserResponse = z.infer<typeof UserResponseSchema>
