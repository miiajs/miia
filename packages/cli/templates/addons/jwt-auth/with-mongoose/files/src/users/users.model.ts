import { defineModel } from '@miiajs/mongoose'
import { Schema } from 'mongoose'

interface UserDocument {
  email: string
  passwordHash: string
}

export const UsersModel = defineModel<UserDocument>(
  'User',
  new Schema<UserDocument>(
    {
      email: { type: String, required: true, unique: true },
      passwordHash: { type: String, required: true },
    },
    { timestamps: true },
  ),
)
