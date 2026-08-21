---
'@miiajs/multipart': minor
---

Add `@miiajs/multipart`: streaming `multipart/form-data` with per-part backpressure.

`@Multipart(options?)` opens a route and attaches two ways to read the body, both typed by the
exported `MultipartContext`. `ctx.parts` is an async iterator over the parts - a file part carries
a `ReadableStream`, and the source is read only when every queue the consumer can still drain is
empty, so a large upload streams through instead of landing in memory. Exactly one part is consumed
at a time: moving the iterator forward abandons the previous part and errors its stream rather than
closing it, so a half-read upload can never look complete. `ctx.form<T>()` is the buffered path -
one pass into `{ files, fields }`, cached per request like `ctx.json()`.

`@ValidateForm(schema)` validates the buffered form against a flat object - text fields next to
files under their own names, the way OpenAPI describes a multipart body - answers 422 on failure,
and replaces the cache so `ctx.form<T>()` returns the schema's data.

Limits are per file, per part count, and per form: `maxFileSize`, `maxFiles`, `maxFields`,
`maxFieldSize`, `maxFieldNameSize`. The route's body budget follows an explicit `bodyLimit`,
otherwise `maxFileSize * maxFiles + fieldsBudget` when both are finite, otherwise a `@BodyLimit`
on the method or controller. Exceeding a limit is a 413, a malformed or non-multipart body a 400.

`allowedTypes` restricts file parts to a list of media types (exact, or `image/*`), refusing a part
with a 415 before its body is read. It reads the part's declared `Content-Type`, so treat it as an
early, uniform rejection rather than a content check.
