import { z } from 'zod'

export const UserIdParamsSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{24}$/i, { message: 'Must be a 24-character hex ObjectId' }),
})
