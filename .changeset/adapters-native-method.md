---
'@miiajs/node-server': patch
'@miiajs/uws-server': patch
---

In `mode: 'native'` a request whose method a `Request` cannot carry is answered by the adapter without reaching the app: `TRACE`, `TRACK` and `CONNECT`, which fetch forbids, get a `501`, and a method that is not a valid token gets a `400`. Before, uws-server threw out of its request handler and took the process down, and node-server logged an unhandled error and answered `500` (Node's own parser already answers `TRACK` and passes `CONNECT` to the `connect` event). A body that came with the request is dropped. `mode: 'optimized'` keeps handing these methods to the app, as Bun and Deno do.
