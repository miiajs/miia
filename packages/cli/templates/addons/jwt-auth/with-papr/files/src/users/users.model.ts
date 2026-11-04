import { defineModel } from '@miiajs/papr'
import { schema, types } from 'papr'

const usersSchema = schema(
  {
    email: types.string({ required: true }),
    passwordHash: types.string({ required: true }),
  },
  { timestamps: true },
)

export const UsersModel = defineModel('users', usersSchema)
