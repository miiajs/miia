import { createMethodDecorator, setInMapMeta, type ZodLike } from '@miiajs/core'
import { API_BODY_OPTIONS, API_BODY_SCHEMAS } from '../constants.js'
import type { ApiBodyOptions, JsonSchema } from '../types.js'

/**
 * Document a route's request body for OpenAPI **without** validating it.
 *
 * In the spec it overrides the route's `body` schema (from `@Post('/', { body })`)
 * and its content type, whatever the decorator order. On its own it adds no `422`
 * response, because it says nothing about validation - declare `@ApiResponse(422)`
 * if your own code answers with one.
 *
 * Use it when the body is checked elsewhere (e.g. inside an auth provider or a
 * custom middleware), or when the schema converter cannot express the shape
 * (e.g. multipart file fields as `format: 'binary'`). A route that validates its
 * body through `{ body }` needs no `@ApiBody` - the schema is discovered from there.
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
    setInMapMeta(context.metadata!, API_BODY_SCHEMAS, String(context.name), schema)
    if (options) {
      setInMapMeta(context.metadata!, API_BODY_OPTIONS, String(context.name), options)
    }
  },
)
