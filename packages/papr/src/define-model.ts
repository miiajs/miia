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

// Not memoized: the export site is the identity (one per collection). A second defineModel('users', schema) is a
// separate token on purpose, for a second connection. Two tokens for one collection on one connection fail in
// PaprService.onInit; one token on two connections fails at startup, as a shared register() provider.
export function defineModel<TSchema extends BaseSchema, TOptions extends SchemaOptions<TSchema>>(
  collectionName: string,
  schema: [TSchema, TOptions],
): ModelToken<TSchema, TOptions> {
  const token = createToken<Model<TSchema, TOptions>>(`PaprModel(${collectionName})`, {
    hint: `PaprModule.register([${collectionName}])`,
  })
  return Object.freeze({ ...token, collectionName, schema, __miiaPaprModel: true as const })
}
