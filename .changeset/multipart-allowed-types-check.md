---
'@miiajs/multipart': minor
---

`@Multipart({ allowedTypes })` throws a `TypeError` when the class is defined if the list is empty or an entry is not a type and a subtype (`'png'`, `'image/'`, `' / '`). None of them can match a file, so every upload used to end in a 415 at request time. To take no files at all, set `maxFiles: 0`.

Breaking: an empty `allowedTypes` list, which used to refuse every file part with a 415, now throws a `TypeError` when the class is defined. Use `maxFiles: 0` to take no files.
