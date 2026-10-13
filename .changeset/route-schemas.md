---
'@miiajs/core': minor
'@miiajs/multipart': minor
'@miiajs/swagger': minor
---

Move request schemas into the route decorator

`@ValidateBody`, `@ValidateQuery` and `@ValidateParams` (core) and `@ValidateForm` (multipart) are removed, with no
aliases. A route's schemas now go into its HTTP method decorator: `@Post(path?, { body, query, params })`, or
`@Post({ ... })` for a route at the controller prefix. GET, HEAD and OPTIONS take `query` and `params` only. The option
types `RouteOptions` and `RouteOptionsWithoutBody` are exported from `@miiajs/core`. `@Multipart` now only says how the
body is read and within which limits; the route's `body` schema validates the form.

**Migration.** Move each schema into the route decorator and drop the old import. Handlers read the data the same way
as before: `ctx.json<T>()`, `ctx.query`, `ctx.params`, `ctx.form<T>()`.

```ts
// Before
@Post('/')
@ValidateBody(CreateUser)
create(ctx: RequestContext) {}

@Get('/')
@ValidateQuery(Paging)
list(ctx: RequestContext) {}

@Patch(':id')
@ValidateParams(IdParams)
@ValidateBody(UpdateUser)
update(ctx: RequestContext) {}

@Post('avatar')
@Multipart({ maxFileSize: MAX, maxFiles: 1 })
@ValidateForm(AvatarForm)
upload(ctx: MultipartContext) {}

// After
@Post('/', { body: CreateUser })
create(ctx: RequestContext) {}

@Get({ query: Paging })
list(ctx: RequestContext) {}

@Patch(':id', { params: IdParams, body: UpdateUser })
update(ctx: RequestContext) {}

@Post('avatar', { body: AvatarForm })
@Multipart({ maxFileSize: MAX, maxFiles: 1 })
upload(ctx: MultipartContext) {}
```

**Behaviour changes.**

- The order is fixed: params, then query, then body. Before, decorator order decided it, so `@ValidateParams` above
  `@ValidateBody` checked the body first. Invalid params together with an invalid body now answer
  `'Params validation failed'` instead of `'Body validation failed'`.
- Validation runs after every guard and every route middleware, right before the handler. A method-level `@Use` used
  to run before or after a `@Validate*` depending on decorator order; it now sees the raw `ctx.params`, `ctx.query` and
  body before `await next()` and the validated ones after it.
- Some mistakes now throw a `TypeError` when the class is defined: a `body` schema on GET, HEAD or OPTIONS; a GET, HEAD
  or OPTIONS route and a `body` schema on the same handler, in either decorator order; two different schemas for the
  same key on one handler. Routes stacked on one method share its schemas.
- A multipart form that fails its schema answers `'Body validation failed'`, not `'Form validation failed'`.
- `BODY_SCHEMAS`, `QUERY_SCHEMAS` and `PARAMS_SCHEMAS` now turn on runtime validation: the router builds the validation
  step from them, so a custom decorator that writes them gets its routes validated.

**`@ApiBody` and 422.** `@ApiBody` no longer writes `BODY_SCHEMAS` and no longer adds a 422 response on its own. It
keeps its own key, only documents, and overrides the route's `body` schema and content type in the spec whatever the
decorator order. The spec gets a 422 only when the route declares a `body`, `query` or `params` schema, so a route
whose own code answers 422 behind an `@ApiBody` should declare `@ApiResponse(422)`. The request body's content type is
the `@ApiBody` option, else the route's body reader (`multipart/form-data` under `@Multipart`), else `application/json`.

**Body readers.** `BODY_READERS` (`Map<handlerName, BodyReader>`) and the `BodyReader` type
(`{ contentType, read(ctx), commit(ctx, data) }`) are new exports of `@miiajs/core`. A reader decides what a route's
`body` schema validates and where the validated data goes; `contentType` is what the spec shows. Without one the
built-in JSON reader is used: malformed JSON answers 400 before the schema runs, an empty body reaches the schema as
`undefined`, and an oversized body stays a 413. `@Multipart` registers a form reader.
