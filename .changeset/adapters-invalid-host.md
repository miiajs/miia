---
'@miiajs/node-server': patch
'@miiajs/uws-server': patch
---

A request whose `Host` header makes no valid URL (`Host: x:99999`, `Host: [::1`) is served, as on Bun and Deno. `new Request()` refused the URL built from that header, so in `mode: 'optimized'` reading a streamed body (chunked, or over `bufferThreshold`) failed, and in `mode: 'native'` node-server answered every such request with a 500 while uws-server threw out of its request handler and took the process down. The request is now built on `http://localhost` and its own path when the header makes no URL: `ctx.req.url` keeps the header as it came in `mode: 'optimized'`, and is `http://localhost/...` in `mode: 'native'`, where it must parse.

In `mode: 'native'` the `Host` header can no longer move a request to another route either. The URL was built by putting the header in front of the request target, so `GET /public` with `Host: x/admin` reached `/admin/public`, and a query, a fragment or a backslash in the header moved it too. Only a `Host` that is `host[:port]` or `[IPv6]:port` goes into the URL now; any other is replaced with `localhost`, and on node-server an empty one with the address the server listens on, as on uws-server. `mode: 'optimized'` routes by the request target alone and was not affected.
