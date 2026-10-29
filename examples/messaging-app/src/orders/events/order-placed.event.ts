import { defineEvent, type EventPayload } from '@miiajs/messaging'
import { z } from 'zod'

export const OrderPlaced = defineEvent(
  'order.placed',
  z.object({
    orderId: z.string().min(1),
    customerEmail: z.email(),
    total: z.number().positive(),
    items: z.array(
      z.object({
        sku: z.string().min(1),
        qty: z.number().int().positive(),
      }),
    ),
  }),
)

export type OrderPlaced = EventPayload<typeof OrderPlaced>
