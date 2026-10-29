import { defineEvent, type EventPayload } from '@miiajs/messaging'
import { z } from 'zod'

export const PaymentCharge = defineEvent(
  'payment.charge',
  z.object({
    paymentId: z.string().min(1),
    orderId: z.string().min(1),
    amount: z.number().positive(),
  }),
)

export type PaymentCharge = EventPayload<typeof PaymentCharge>
