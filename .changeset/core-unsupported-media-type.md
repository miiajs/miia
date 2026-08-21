---
'@miiajs/core': minor
---

Add `UnsupportedMediaTypeException` (415) to the exception hierarchy, and `415` to the status-text
map behind `HttpException.toJSON()`, so a media-type rejection reads `"error": "Unsupported Media
Type"` instead of the generic `"error": "Error"`.

`@miiajs/multipart` raises it when a file part declares a media type outside `allowedTypes`; it is
exported like every other built-in exception, so applications can throw it directly for any
content-negotiation refusal of their own.
