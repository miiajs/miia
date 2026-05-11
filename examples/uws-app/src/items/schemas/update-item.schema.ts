import { z } from 'zod'

export const UpdateItemSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.number().nonnegative().optional(),
})
