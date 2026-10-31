---
'@miiajs/node-server': patch
---

Cancelling a streamed request body no longer ends the process. `ctx.req.body.cancel()`, or cancelling a `pipeThrough` of it or a reader on it, could throw an uncaught `ERR_INVALID_STATE: Controller is already closed` from `Readable.toWeb` with upload data buffered, and otherwise left the connection unable to carry another request: the rest of the body was never read, while the response advertised keep-alive. A cancel now only stops reading the body. The response the handler returns goes out on the connection as usual, the rest of the body is drained after it (500 ms, 64 MB, as for the early 413), and the next request is answered on the same connection, or the connection is closed if the client has not finished by then. The body stream no longer comes from `Readable.toWeb`; a body read to the end, or failing on a client that went away, behaves as before.
