---
'@miiajs/multipart': minor
---

`@Multipart({ allowedTypes })` checks its list when the class is defined. An empty list or an entry that is not a type and a subtype (`'png'`, `'image/'`, `' / '`) cannot match a file, so every upload used to end in a 415 at request time.

Breaking: such a list now throws a `TypeError` when the class is defined. To take no files at all, set `maxFiles: 0`.
