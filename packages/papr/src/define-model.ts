import type { BaseSchema, Model, SchemaOptions } from 'papr'

export type ModelToken<TSchema extends BaseSchema, TOptions extends SchemaOptions<TSchema>> = (new () => Model<
  TSchema,
  TOptions
>) & {
  readonly collectionName: string
  readonly schema: [TSchema, TOptions]
  readonly __miiaPaprModel: true
}

// defineModel не мемоізується: identity = export site (один раз на колекцію).
// Повторний defineModel('users', schema) свідомо створює окремий токен -
// для multi-connection use-case. Колізія колекцій ловиться runtime у
// PaprService.onInit, cross-registry колізія - через console.warn у register().
export function defineModel<TSchema extends BaseSchema, TOptions extends SchemaOptions<TSchema>>(
  collectionName: string,
  schema: [TSchema, TOptions],
): ModelToken<TSchema, TOptions> {
  const Token = class {
    static collectionName = collectionName
    static schema = schema
    static __miiaPaprModel = true as const
  }
  Object.defineProperty(Token, 'name', { value: `PaprModel(${collectionName})` })
  return Token as unknown as ModelToken<TSchema, TOptions>
}
