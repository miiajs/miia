import type mongoose from 'mongoose'

export interface MongooseModuleOptions {
  uri: string
  connectionOptions?: mongoose.ConnectOptions
  retry?: {
    attempts?: number
    delay?: number
  }
}

export type { ModelToken } from './define-model.js'
export type { MongooseConnectionToken } from './tokens.js'
