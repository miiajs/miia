---
'@miiajs/core': minor
---

`cors()` treats only an `OPTIONS` request carrying both `Origin` and `Access-Control-Request-Method` as a preflight, as the Fetch spec defines it, and answers it with 204. Any other `OPTIONS` request goes on to the router - to an `@Options` route, or a 404 - with the CORS headers a simple request from the same origin gets. Before, `cors()` answered every `OPTIONS` from an allowed origin with 204, so an `@Options` route behind it was never reached.
