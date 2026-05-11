import { BODY_SCHEMAS, createMethodDecorator, setInMapMeta, type ZodLike } from '@miiajs/core'
import { API_BODY_OPTIONS } from '../constants.js'
import type { ApiBodyOptions, JsonSchema } from '../types.js'

/**
 * Document a route's request body for OpenAPI **without** running runtime
 * validation. Writes to the same `BODY_SCHEMAS` metadata key that `@ValidateBody`
 * uses, so `SpecBuilder` picks it up automatically.
 *
 * Use when the request body is validated elsewhere (e.g. inside an auth
 * provider, a custom middleware, or consumed raw as a stream) but you still
 * want Swagger to show the expected shape. If you already apply `@ValidateBody`,
 * you don't need `@ApiBody` - the schema is discovered from the validator.
 *
 * ## Content type
 *
 * Pass `{ contentType }` as the second argument to describe a non-JSON body -
 * for example, `multipart/form-data` for file uploads. The schema can be any
 * `ZodLike`, or a raw OpenAPI JSON Schema object when Zod cannot express the
 * shape (e.g. binary file fields).
 *
 * **Raw JSON Schema requirement:** raw (non-Zod) schemas passed here must
 * include a top-level `type` field. Unions without `type` (e.g. `{ anyOf }`)
 * currently fall back to `{ type: 'object' }` - use a Zod schema for those.
 *
 * @example
 * ```ts
 * @Post(':id/avatar')
 * @ApiBody(
 *   {
 *     type: 'object',
 *     properties: { file: { type: 'string', format: 'binary' } },
 *     required: ['file'],
 *   },
 *   { contentType: 'multipart/form-data' },
 * )
 * uploadAvatar(ctx: RequestContext) { ... }
 * ```
 */
export const ApiBody = createMethodDecorator<[schema: ZodLike | JsonSchema, options?: ApiBodyOptions]>(
  (_target, context, schema, options) => {
    setInMapMeta(context.metadata!, BODY_SCHEMAS, String(context.name), schema)
    if (options) {
      setInMapMeta(context.metadata!, API_BODY_OPTIONS, String(context.name), options)
    }
  },
)
