---
'@miiajs/uws-server': patch
---

The `413` for a declared `Content-Length` over `maxBodySize` says `Connection: close`. The connection cannot carry another request until the declared body is through, and before, a client that reused it had its next request taken for part of that body. uWS still discards the body, and the client closes the connection as told; one that sent only the headers and keeps the connection open is closed by uWS's idle timeout, about 10 s.
