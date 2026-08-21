---
'@miiajs/node-server': patch
---

Send `Connection: close` when the handler answers without reading the request body.

Unread bytes are still on the socket, so the connection cannot carry another request - RFC 9112
section 9.6 says so plainly. Node kept advertising keep-alive and then tore the socket down anyway,
which stranded whatever a pooled client sent next: the following request came back as a closed
socket rather than a response. It surfaced against Bun 1.4's fetch, whose connection pool is
stricter than 1.3's; curl had been papering over it by opening a fresh connection.

The check needs `hasBody` as well as the stream flags, because a GET with nothing to read reports
`readableEnded` and `complete` as false too. A GET, a 404, and a POST whose body the handler drained
all keep keep-alive as before.

This is the same rule `send413` already followed for the early payload rejection; it now covers the
ordinary response path in both optimized and native mode.
