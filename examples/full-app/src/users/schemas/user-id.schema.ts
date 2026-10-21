import { z } from 'zod'

// users.id is a Postgres serial, a 4-byte integer
export const UserIdParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2_147_483_647),
})

export type UserIdParams = z.infer<typeof UserIdParamsSchema>
