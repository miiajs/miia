import { z } from 'zod'

export const Create__Name__Schema = z.object({
  name: z.string().min(1),
})

export const Update__Name__Schema = Create__Name__Schema.partial()

export const __Name__IdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export type Create__Name__Input = z.infer<typeof Create__Name__Schema>
export type Update__Name__Input = z.infer<typeof Update__Name__Schema>
export type __Name__IdParams = z.infer<typeof __Name__IdParamsSchema>
