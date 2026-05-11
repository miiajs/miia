import { schema, types } from 'papr'
import { defineModel } from '@miiajs/papr'

export const userSchema = schema(
  {
    name: types.string({ required: true }),
    email: types.string({ required: true }),
    role: types.string({ required: true }),
  },
  {
    defaults: {
      role: 'user',
    },
    timestamps: true,
  },
)

export const User = defineModel('users', userSchema)

export type UserDocument = (typeof userSchema)[0]
