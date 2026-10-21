---
'@miiajs/multipart': patch
---

`@Multipart` on an override in a subclass controller replaces the one the handler inherited, as the controller docs say. Before, both ran: the parent's set up the parts with the parent's options and the override's reused them, so stricter `allowedTypes` or limits on the override did not apply. The override's `@Multipart` takes the parent's place among the handler's middleware, and the parent class is left as it was.
