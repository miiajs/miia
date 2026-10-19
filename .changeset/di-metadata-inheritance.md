---
'@miiajs/core': patch
---

A subclass decorated with `@Get`, `@Use`, `@UseGuard`, `@SkipGuard`, `@Status`, `@BodyLimit`, `@On` and other decorators built on the metadata helpers no longer writes into its parent's metadata: `pushMeta()`, `addToMapMeta()`, `setInMapMeta()` and `@SkipGuard` copy an inherited array or `Map` before writing, so the subclass sees the parent's entries plus its own and a parent controller no longer gets its subclass's routes.
