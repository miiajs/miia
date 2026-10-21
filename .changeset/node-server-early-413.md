---
'@miiajs/node-server': patch
---

A client uploading a body whose declared `Content-Length` is over `maxBodySize` gets its `413`. The answer said `Connection: close`, so Node destroyed the socket as soon as it was written, with the upload still arriving, and that resets the connection: the `413` was lost to up to a third of `fetch` and a tenth of `node:http` uploads of 64 MB, and to about half of plain uploads that do not read the answer before they finish (measured on Node). The `413` now keeps the connection (and goes out under a `Content-Length` instead of chunked) while the adapter reads and drops the rest of the body, as it already did, for at most 500 ms and 64 MB: a body that gets through in that time leaves the connection ready for the next request, anything longer has it destroyed. A client that sends no body is let go after the 500 ms, and such a connection can hold `close()` that long. Both modes.
