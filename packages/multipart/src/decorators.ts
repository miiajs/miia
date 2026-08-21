import {
  addToMapMeta,
  BODY_LIMITS,
  createMethodDecorator,
  METHOD_MW,
  setInMapMeta,
  UnprocessableException,
} from '@miiajs/core'
import type { Middleware, RequestContext, ZodLike } from '@miiajs/core'
import { collectForm } from './form.js'
import { createPartStream, DEFAULT_FIELDS_BUDGET } from './parser.js'
import type { FormResult, MultipartOptions, MultipartPart } from './types.js'

/** Per-handler `@Multipart` options, read back at request time. */
export const MULTIPART_OPTIONS = Symbol('multipartOptions')

const MULTIPART_STATE = Symbol('multipartState')

type Metadata = Record<string | symbol, any>

/**
 * The class's decorator metadata, which `tsc` creates only when
 * `Symbol.metadata` exists at class-definition time - a build that drops
 * `@miiajs/core`'s polyfill import leaves it `undefined`, and the decorators
 * below would then fail deep inside a metadata write.
 */
function metadataOf(context: ClassMethodDecoratorContext, decorator: string): Metadata {
  const metadata = context.metadata
  if (!metadata) {
    throw new TypeError(
      `@${decorator} cannot read decorator metadata. Import @miiajs/core before the decorated class is defined - its Symbol.metadata polyfill has to run first.`,
    )
  }
  return metadata
}

interface MultipartState {
  /** The bridge's own iterator - what `collectForm` drains and cleanup returns. */
  parts: AsyncIterableIterator<MultipartPart>
  /** Whether the handler walked `ctx.parts` itself. */
  partsUsed: boolean
  form: Promise<unknown> | null
  /** Replaces the cached form, so `ctx.form<T>()` hands back validated data. */
  setForm(data: unknown): void
}

type StatefulContext = RequestContext & {
  parts: AsyncIterableIterator<MultipartPart>
  form: <T = FormResult>() => Promise<T>
  [MULTIPART_STATE]?: MultipartState
}

/**
 * Streams a `multipart/form-data` body: the handler gets `ctx.parts` (an async
 * iterator over the parts, one consumed at a time) and `ctx.form()` (the whole
 * form buffered into `File`s and strings). Type the handler's context as
 * `MultipartContext` to see both.
 *
 * A non-`multipart/form-data` request is rejected with 400 before the handler
 * runs, whether or not it reads the body, and whatever is left unread is
 * discarded once the handler returns.
 *
 * Body budget: an explicit `bodyLimit` wins; otherwise
 * `maxFileSize * maxFiles + fieldsBudget` becomes the route's limit when both
 * are finite; with neither, a `@BodyLimit` on the route (or its controller)
 * becomes the budget, and without one only the adapter ceiling applies. The
 * route limit belongs to whichever decorator wrote it last, so do not put
 * `@Multipart` and `@BodyLimit` on the same method.
 */
export const Multipart = createMethodDecorator<[options?: MultipartOptions]>((_target, context, options = {}) => {
  const name = String(context.name)
  const metadata = metadataOf(context, 'Multipart')
  setInMapMeta(metadata, MULTIPART_OPTIONS, name, options)

  const bodyLimit = options.bodyLimit ?? deriveBodyLimit(options)
  if (bodyLimit !== undefined) setInMapMeta(metadata, BODY_LIMITS, name, bodyLimit)

  // Options come from the metadata, not from this closure: the state may be
  // built by whichever multipart middleware the decorator order put outside.
  const mw: Middleware = (ctx, next) => withMultipartState(ctx, runtimeOptions(metadata, name), () => next())
  addToMapMeta(metadata, METHOD_MW, name, [mw])
})

/**
 * Validates the buffered form against a schema. What the schema sees is a flat
 * object - text fields as strings (last value wins) next to files under their
 * own names, a single `File` or a `File[]` when the name repeats - which is how
 * a multipart body is described in OpenAPI, so a schema reads as
 * `z.object({ title: z.string(), doc: z.instanceof(File) })`.
 *
 * A failed parse answers 422 with the schema's issues; a successful one
 * replaces the cached form, so `ctx.form<T>()` returns the schema's data
 * instead of the raw `FormResult`. The method also needs `@Multipart` - in
 * either order.
 */
export const ValidateForm = createMethodDecorator<[schema: ZodLike]>((_target, context, schema) => {
  const name = String(context.name)
  const metadata = metadataOf(context, 'ValidateForm')

  const mw: Middleware = async (ctx, next) => {
    const declared = metadata[MULTIPART_OPTIONS] as Map<string, MultipartOptions> | undefined
    if (!declared?.has(name)) {
      throw new Error(`@ValidateForm on "${name}" needs @Multipart on the same method - there is no form to validate`)
    }

    await withMultipartState(ctx, runtimeOptions(metadata, name), async (state) => {
      const result = schema.safeParse(flattenForm(await (ctx as StatefulContext).form()))
      if (!result.success) {
        throw new UnprocessableException('Form validation failed', result.error.issues)
      }

      state.setForm(result.data)
      await next()
    })
  }
  addToMapMeta(metadata, METHOD_MW, name, [mw])
})

/** Fields and files side by side under their own names, the way a schema reads them. */
function flattenForm({ files, fields }: FormResult): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...fields }
  for (const [name, group] of Object.entries(files)) {
    flat[name] = group.length === 1 ? group[0] : group
  }
  return flat
}

/**
 * Runs the rest of the pipeline with `ctx.parts` and `ctx.form()` in place.
 * Both multipart middlewares call it, so the decorator order does not matter.
 *
 * Whoever built the state disposes of it: an outer `@ValidateForm` answering
 * 422 keeps the `@Multipart` middleware from ever running, so the stream would
 * otherwise be left behind by the one middleware that could not clean up.
 */
async function withMultipartState(
  ctx: RequestContext,
  options: MultipartOptions,
  run: (state: MultipartState) => Promise<void>,
): Promise<void> {
  const target = ctx as StatefulContext
  const existing = target[MULTIPART_STATE]
  if (existing) return run(existing)

  const state = createState(target, options)
  try {
    await run(state)
  } finally {
    await state.parts.return?.()
  }
}

/** Attaches `ctx.parts` and `ctx.form()` for the rest of the request. */
function createState(target: StatefulContext, options: MultipartOptions): MultipartState {
  const parts = createPartStream(target.req, options)
  const state: MultipartState = {
    parts,
    partsUsed: false,
    form: null,
    setForm(data) {
      state.form = Promise.resolve(data)
    },
  }
  target[MULTIPART_STATE] = state
  target.parts = trackParts(state)
  target.form = <T = FormResult>(): Promise<T> => {
    if (state.form === null && state.partsUsed) {
      return Promise.reject(
        new TypeError('ctx.form() cannot run after ctx.parts - the body is consumed once, in one of the two ways'),
      )
    }
    return (state.form ??= collectForm(state.parts)) as Promise<T>
  }
  return state
}

/**
 * `ctx.parts`, wrapped so the two ways of reading the body cannot be mixed.
 *
 * Both read the same source, so whichever runs second finds it spent. Left
 * alone that surfaces as an empty form or an empty loop - the shape of failure
 * that looks like a working request with no data in it.
 */
function trackParts(state: MultipartState): AsyncIterableIterator<MultipartPart> {
  const tracked: AsyncIterableIterator<MultipartPart> = {
    [Symbol.asyncIterator]() {
      return tracked
    },
    next() {
      if (state.form !== null) {
        return Promise.reject(
          new TypeError('ctx.parts cannot run after ctx.form() - the body is consumed once, in one of the two ways'),
        )
      }
      state.partsUsed = true
      return state.parts.next()
    },
    return: () => state.parts.return?.() ?? Promise.resolve({ value: undefined, done: true as const }),
  }
  return tracked
}

/**
 * The route's options with the body budget resolved down to its last fallback:
 * the metadata is complete by request time, so a `@BodyLimit` written by
 * another decorator can still become `maxTotalSize`.
 */
function runtimeOptions(metadata: Metadata, name: string): MultipartOptions {
  const options = (metadata[MULTIPART_OPTIONS] as Map<string, MultipartOptions> | undefined)?.get(name) ?? {}
  if (options.bodyLimit !== undefined || deriveBodyLimit(options) !== undefined) return options

  const limits = metadata[BODY_LIMITS] as Map<string, number> | undefined
  const bodyLimit = limits?.get(name) ?? limits?.get('*')
  return bodyLimit === undefined ? options : { ...options, bodyLimit }
}

function deriveBodyLimit(options: MultipartOptions): number | undefined {
  const { maxFileSize, maxFiles } = options
  if (maxFileSize === undefined || maxFiles === undefined) return undefined
  if (!Number.isFinite(maxFileSize) || !Number.isFinite(maxFiles)) return undefined
  return maxFileSize * maxFiles + (options.fieldsBudget ?? DEFAULT_FIELDS_BUDGET)
}
