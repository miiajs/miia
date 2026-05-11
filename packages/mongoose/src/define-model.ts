import type mongoose from 'mongoose'

export type ModelToken<T> = (new () => mongoose.Model<T>) & {
  readonly modelName: string
  readonly schema: mongoose.Schema<T>
  readonly __miiaMongooseModel: true
}

// defineModel не мемоізується: identity = export site (один раз на модель).
// Повторний defineModel('User', schema) свідомо створює окремий токен -
// для multi-connection use-case. Колізія імен моделей ловиться runtime у
// MongooseService.onInit, cross-registry колізія - через console.warn у register().
export function defineModel<T>(name: string, schema: mongoose.Schema<T>): ModelToken<T> {
  const Token = class {
    static modelName = name
    static schema = schema
    static __miiaMongooseModel = true as const
  }
  Object.defineProperty(Token, 'name', { value: `MongooseModel(${name})` })
  return Token as unknown as ModelToken<T>
}
