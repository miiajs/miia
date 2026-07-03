import { z } from 'zod'

export const PrefsSchema = z.object({
  theme: z.enum(['light', 'dark']),
})

export type PrefsInput = z.infer<typeof PrefsSchema>
