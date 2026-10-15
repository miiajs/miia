import type { Token } from '@miiajs/core'
import { createToken } from '@miiajs/core'
import type { BaseSchema, Model, SchemaOptions } from 'papr'

export type ModelToken<TSchema extends BaseSchema, TOptions extends SchemaOptions<TSchema>> = Token<
  Model<TSchema, TOptions>
> & {
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
  const token = createToken<Model<TSchema, TOptions>>(`PaprModel(${collectionName})`, {
    hint: 'PaprModule.register([...])',
  })
  return Object.freeze({ ...token, collectionName, schema, __miiaPaprModel: true as const })
}
