import { z } from 'zod'

export const UserIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export type UserIdParams = z.infer<typeof UserIdParamsSchema>
