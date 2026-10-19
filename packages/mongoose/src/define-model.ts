import type { Token } from '@miiajs/core'
import { createToken } from '@miiajs/core'
import type mongoose from 'mongoose'

export type ModelToken<T> = Token<mongoose.Model<T>> & {
  readonly modelName: string
  readonly schema: mongoose.Schema<T>
  readonly __miiaMongooseModel: true
}

// defineModel не мемоізується: identity = export site (один раз на модель).
// Повторний defineModel('User', schema) свідомо створює окремий токен -
// для multi-connection use-case. Колізія імен моделей ловиться runtime у
// MongooseService.onInit, а той самий токен на двох з'єднаннях - помилка спільного
// провайдера register() на старті застосунку.
export function defineModel<T>(name: string, schema: mongoose.Schema<T>): ModelToken<T> {
  const token = createToken<mongoose.Model<T>>(`MongooseModel(${name})`, {
    hint: `MongooseModule.register([${name}])`,
  })
  return Object.freeze({ ...token, modelName: name, schema, __miiaMongooseModel: true as const })
}
