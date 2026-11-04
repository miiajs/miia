import { z } from 'zod'

export const Create__Name__Schema = z.object({
  name: z.string().min(1),
})

export type Create__Name__Input = z.infer<typeof Create__Name__Schema>
