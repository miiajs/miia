import { z } from 'zod'

export const CreateItemSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative(),
})
