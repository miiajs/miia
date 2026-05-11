import { z } from 'zod'
import { UserResponseSchema } from './user-response.schema.js'

export const PaginatedUsersResponseSchema = z.object({
  items: z.array(UserResponseSchema),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
})

export type PaginatedUsersResponse = z.infer<typeof PaginatedUsersResponseSchema>
