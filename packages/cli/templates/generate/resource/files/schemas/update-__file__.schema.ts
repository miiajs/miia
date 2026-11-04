import type { z } from 'zod'
import { Create__Name__Schema } from './create-__file__.schema.js'

export const Update__Name__Schema = Create__Name__Schema.partial()

export type Update__Name__Input = z.infer<typeof Update__Name__Schema>
