---
'@miiajs/messaging-redis': minor
---

Require Redis 7.2 or newer

The supported minimum is now Redis 7.2. Valkey works and is part of the test matrix. `onInit()` reads the server
version with `HELLO` and logs a warning on anything older - the transport still starts. The 6.2-only path that acked
pending entries trimmed out of the stream is gone.
