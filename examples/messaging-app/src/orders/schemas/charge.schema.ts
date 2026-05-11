import { z } from 'zod'

export const ChargeSchema = z.object({
  orderId: z.string().min(1),
  amount: z.number().positive(),
})

export type ChargeInput = z.infer<typeof ChargeSchema>
