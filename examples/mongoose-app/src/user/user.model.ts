import { Schema } from 'mongoose'
import { defineModel } from '@miiajs/mongoose'

export interface IUser {
  name: string
  email: string
  role: string
}

export const User = defineModel<IUser>(
  'User',
  new Schema<IUser>(
    {
      name: { type: String, required: true },
      email: { type: String, required: true },
      role: { type: String, default: 'user' },
    },
    { timestamps: true },
  ),
)
