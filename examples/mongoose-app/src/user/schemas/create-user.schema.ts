import { z } from 'zod'

export const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

export type CreateUserInput = z.infer<typeof CreateUserSchema>
