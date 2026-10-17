---
'@miiajs/serve-static': patch
---

`etag: false` turns conditional GET off, as documented. It used to stop sending `ETag` and `Last-Modified` but still answered 304 to a client's `If-None-Match` or `If-Modified-Since`; those headers are now ignored and the file is sent.
