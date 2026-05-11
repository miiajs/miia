import { z } from 'zod'

export const PlaceOrderSchema = z.object({
  orderId: z.uuid().optional(),
  customerEmail: z.email(),
  total: z.number().positive(),
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        qty: z.number().int().positive(),
      }),
    )
    .nonempty(),
})

export type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>
