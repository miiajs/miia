import { defineEvent, type EventPayload } from '@miiajs/messaging'
import { z } from 'zod'

export const NotificationSend = defineEvent(
  'notification.send',
  z.object({
    orderId: z.string().min(1),
    to: z.email(),
    template: z.literal('order-confirmation'),
  }),
)

export type NotificationSend = EventPayload<typeof NotificationSend>
