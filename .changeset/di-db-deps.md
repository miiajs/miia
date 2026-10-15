---
'@miiajs/drizzle': patch
'@miiajs/papr': patch
'@miiajs/mongoose': patch
---

A provider that injects the db / connection now gets `onInit()` after the connection opens and `onDestroy()` before it closes, whatever the module order: `drizzleDb()`, `paprDb()` and `mongooseConnection()` declare `deps` on the service that owns the connection.
