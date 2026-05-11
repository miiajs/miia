import { z } from 'zod'

export const DuplicateNotificationSchema = z.object({
  orderId: z.string().min(1),
  customerEmail: z.email(),
})

export type DuplicateNotificationInput = z.infer<typeof DuplicateNotificationSchema>
