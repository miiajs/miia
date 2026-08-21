---
'@miiajs/multipart': patch
---

Raise an error when `ctx.parts` and `ctx.form()` are both used on one request.

They read the same source, so whichever ran second found it spent - and said nothing about it.
`ctx.form()` after walking the parts answered `{ files: {}, fields: {} }`, and walking the parts
after `ctx.form()` iterated zero times. Both read like a request that parsed cleanly and happened to
carry no data, which is the worst way for this to fail.

`ctx.parts` is now handed to the handler wrapped, so the package can tell the handler's own walk
apart from the one `ctx.form()` does internally. Mixing the two throws; everything else is untouched -
`ctx.form()` still caches across repeated calls, and `@ValidateForm` still replaces that cache and
hands its data to the handler.
