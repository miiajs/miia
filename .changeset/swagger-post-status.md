---
'@miiajs/swagger': patch
---

Document 200 for a `POST` route without `@Status`

The spec gave a `POST` route without `@Status` a default `201` response, while the runtime answers such a route with
200 when the handler returns a body (an empty result is 204, as for every method). The default success response is now
200 for every method. Declare `@Status(201)` on create endpoints: it sets the runtime status and the spec follows it.
