import { z } from 'zod'

export const __Name__IdParamsSchema = z.object({
  id: z.uuid(),
})

export type __Name__IdParams = z.infer<typeof __Name__IdParamsSchema>
