import type { Token } from '@miiajs/core'
import { createToken } from '@miiajs/core'
import type mongoose from 'mongoose'

export type ModelToken<T> = Token<mongoose.Model<T>> & {
  readonly modelName: string
  readonly schema: mongoose.Schema<T>
  readonly __miiaMongooseModel: true
}

// Not memoized: the export site is the identity (one per model). A second defineModel('User', schema) is a separate
// token on purpose, for a second connection. Two tokens for one model name on one connection fail in
// MongooseService.onInit; one token on two connections fails at startup, as a shared register() provider.
export function defineModel<T>(name: string, schema: mongoose.Schema<T>): ModelToken<T> {
  const token = createToken<mongoose.Model<T>>(`MongooseModel(${name})`, {
    hint: `MongooseModule.register([${name}])`,
  })
  return Object.freeze({ ...token, modelName: name, schema, __miiaMongooseModel: true as const })
}
